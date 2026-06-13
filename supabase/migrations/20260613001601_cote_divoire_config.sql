insert into public.country_configs(country,currency,calling_code,address_fields,address_config,enabled)
values('CI','XOF','+225',array['line1','area','city','region'],jsonb_build_object('locale','fr-CI','currencyDecimals',0,'paymentChannels',jsonb_build_array('cash_on_delivery','pay_on_pickup','seller_arranged')),true);

insert into public.plan_prices(plan_id,country,currency,interval,amount_minor,active)
select id,'CI','XOF','monthly',0,false from public.plans where code in ('growth','scale') and active;
