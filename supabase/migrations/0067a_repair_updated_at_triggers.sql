-- Forward repair for databases where migration 0012 was recorded before
-- public.update_updated_at_column() and its five triggers were installed.
-- Safe to run repeatedly: function is replaced and triggers are recreated.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_recipe_marketplace_updated ON public.recipe_marketplace;
CREATE TRIGGER trg_recipe_marketplace_updated
  BEFORE UPDATE ON public.recipe_marketplace
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_recipe_subscriptions_updated ON public.recipe_subscriptions;
CREATE TRIGGER trg_recipe_subscriptions_updated
  BEFORE UPDATE ON public.recipe_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_loyalty_partners_updated ON public.loyalty_partners;
CREATE TRIGGER trg_loyalty_partners_updated
  BEFORE UPDATE ON public.loyalty_partners
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_loyalty_cross_actions_updated ON public.loyalty_cross_actions;
CREATE TRIGGER trg_loyalty_cross_actions_updated
  BEFORE UPDATE ON public.loyalty_cross_actions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_ai_conversations_updated ON public.ai_assistant_conversations;
CREATE TRIGGER trg_ai_conversations_updated
  BEFORE UPDATE ON public.ai_assistant_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
