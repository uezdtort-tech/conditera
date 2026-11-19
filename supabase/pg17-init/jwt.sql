\set jwt_exp \`echo "$JWT_EXP"\`

ALTER DATABASE supabase SET "app.settings.jwt_exp" TO :'jwt_exp';
