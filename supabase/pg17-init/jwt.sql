\getenv jwt_exp JWT_EXP
\getenv pgdb POSTGRES_DB

ALTER DATABASE :"pgdb" SET "app.settings.jwt_exp" TO :'jwt_exp';
