-- RS Fitness realtime coach-client chat
-- Run this once in Supabase SQL Editor.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  coach_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_conversations_client_coach_unique UNIQUE (client_id, coach_id)
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  message_text text,
  deleted_for_everyone boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_messages_has_text_or_deleted CHECK (
    deleted_for_everyone = true
    OR length(trim(coalesce(message_text, ''))) > 0
  )
);

CREATE INDEX IF NOT EXISTS chat_conversations_client_id_idx ON public.chat_conversations(client_id);
CREATE INDEX IF NOT EXISTS chat_conversations_coach_id_idx ON public.chat_conversations(coach_id);
CREATE INDEX IF NOT EXISTS chat_messages_conversation_created_idx ON public.chat_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS chat_messages_sender_id_idx ON public.chat_messages(sender_id);

ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_conversations_select_private ON public.chat_conversations;
DROP POLICY IF EXISTS chat_conversations_insert_private ON public.chat_conversations;
DROP POLICY IF EXISTS chat_conversations_update_private ON public.chat_conversations;
DROP POLICY IF EXISTS chat_messages_select_private ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_insert_private ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_update_private ON public.chat_messages;

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.role
  FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.user_can_access_chat_conversation(target_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_conversations cc
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE cc.id = target_conversation_id
      AND p.is_active = true
      AND (
        p.role = 'super_admin'
        OR cc.coach_id = auth.uid()
        OR (p.role = 'client' AND p.client_id = cc.client_id)
      )
  );
$$;

CREATE POLICY chat_conversations_select_private
ON public.chat_conversations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND (
        p.role = 'super_admin'
        OR chat_conversations.coach_id = auth.uid()
        OR (p.role = 'client' AND p.client_id = chat_conversations.client_id)
      )
  )
);

CREATE POLICY chat_conversations_insert_private
ON public.chat_conversations
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND (
        p.role = 'super_admin'
        OR (
          p.role = 'coach'
          AND chat_conversations.coach_id = auth.uid()
          AND EXISTS (
            SELECT 1
            FROM public.clients c
            WHERE c.id = chat_conversations.client_id
              AND c.coach_id = auth.uid()
          )
        )
        OR (
          p.role = 'client'
          AND p.client_id = chat_conversations.client_id
          AND EXISTS (
            SELECT 1
            FROM public.clients c
            WHERE c.id = chat_conversations.client_id
              AND c.coach_id = chat_conversations.coach_id
              AND c.coach_id IS NOT NULL
          )
        )
      )
  )
);

CREATE POLICY chat_conversations_update_private
ON public.chat_conversations
FOR UPDATE
TO authenticated
USING (public.user_can_access_chat_conversation(id))
WITH CHECK (public.user_can_access_chat_conversation(id));

CREATE POLICY chat_messages_select_private
ON public.chat_messages
FOR SELECT
TO authenticated
USING (public.user_can_access_chat_conversation(conversation_id));

CREATE POLICY chat_messages_insert_private
ON public.chat_messages
FOR INSERT
TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND deleted_for_everyone = false
  AND public.user_can_access_chat_conversation(conversation_id)
);

CREATE POLICY chat_messages_update_private
ON public.chat_messages
FOR UPDATE
TO authenticated
USING (
  public.user_can_access_chat_conversation(conversation_id)
  AND (
    sender_id = auth.uid()
    OR public.current_app_role() = 'super_admin'
  )
)
WITH CHECK (
  public.user_can_access_chat_conversation(conversation_id)
  AND (
    sender_id = auth.uid()
    OR public.current_app_role() = 'super_admin'
  )
);

CREATE OR REPLACE FUNCTION public.touch_chat_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.chat_conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_messages_touch_conversation ON public.chat_messages;
CREATE TRIGGER chat_messages_touch_conversation
AFTER INSERT OR UPDATE ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.touch_chat_conversation();

CREATE OR REPLACE FUNCTION public.get_or_create_chat_conversation(target_client_id uuid)
RETURNS public.chat_conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requester public.profiles%ROWTYPE;
  target_coach_id uuid;
  result_row public.chat_conversations%ROWTYPE;
BEGIN
  SELECT *
  INTO requester
  FROM public.profiles
  WHERE id = auth.uid()
    AND is_active = true;

  IF requester.id IS NULL THEN
    RAISE EXCEPTION 'No active app profile found for this login.';
  END IF;

  SELECT coach_id
  INTO target_coach_id
  FROM public.clients
  WHERE id = target_client_id;

  IF target_coach_id IS NULL THEN
    RAISE EXCEPTION 'This client has no assigned coach yet.';
  END IF;

  IF requester.role = 'client' AND requester.client_id IS DISTINCT FROM target_client_id THEN
    RAISE EXCEPTION 'Clients can only open their own chat.';
  END IF;

  IF requester.role = 'coach' AND target_coach_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Coaches can only open chats with assigned clients.';
  END IF;

  IF requester.role NOT IN ('super_admin', 'coach', 'client') THEN
    RAISE EXCEPTION 'This role cannot use chat.';
  END IF;

  INSERT INTO public.chat_conversations (client_id, coach_id, created_by)
  VALUES (target_client_id, target_coach_id, auth.uid())
  ON CONFLICT (client_id, coach_id)
  DO UPDATE SET updated_at = public.chat_conversations.updated_at
  RETURNING * INTO result_row;

  RETURN result_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_chat_message_for_everyone(target_message_id uuid)
RETURNS public.chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_message public.chat_messages%ROWTYPE;
  requester_role text;
  updated_message public.chat_messages%ROWTYPE;
BEGIN
  SELECT *
  INTO target_message
  FROM public.chat_messages
  WHERE id = target_message_id;

  IF target_message.id IS NULL THEN
    RAISE EXCEPTION 'Message not found.';
  END IF;

  SELECT public.current_app_role()
  INTO requester_role;

  IF NOT public.user_can_access_chat_conversation(target_message.conversation_id) THEN
    RAISE EXCEPTION 'You do not have access to this message.';
  END IF;

  IF target_message.sender_id IS DISTINCT FROM auth.uid() AND requester_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'You can only delete your own messages.';
  END IF;

  UPDATE public.chat_messages
  SET
    deleted_for_everyone = true,
    deleted_at = now(),
    message_text = NULL
  WHERE id = target_message_id
  RETURNING * INTO updated_message;

  RETURN updated_message;
END;
$$;

REVOKE ALL ON FUNCTION public.current_app_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_can_access_chat_conversation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_or_create_chat_conversation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_chat_message_for_everyone(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_chat_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_chat_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_chat_message_for_everyone(uuid) TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.chat_conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.chat_messages TO authenticated;

ALTER TABLE public.chat_conversations REPLICA IDENTITY FULL;
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'chat_conversations'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversations;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'chat_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
    END IF;
  END IF;
END $$;
