-- D160 (Scott, Oct 19 2026): DeepSeek v4.1 Flash is pinned to the exact Ollama
-- tag "deepseek-v4.1-flash:1017-cloud". Move saved picks of the floating
-- ":cloud" tag to the pinned one. Every other saved model is left alone.
update provider_settings
   set local_model_id = 'deepseek-v4.1-flash:1017-cloud'
 where local_model_id = 'deepseek-v4.1-flash:cloud';
update newsroom_local_model_choices
   set model_id = 'deepseek-v4.1-flash:1017-cloud'
 where model_id = 'deepseek-v4.1-flash:cloud';
update newsroom_local_model_choices_additional
   set model_id = 'deepseek-v4.1-flash:1017-cloud'
 where model_id = 'deepseek-v4.1-flash:cloud';
