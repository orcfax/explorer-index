# Fact Explorer Index

A fact-indexing service used by the [Orcfax Fact Explorer](https://github.com/orcfax/explorer.orcfax.io) that serves as a flexible proxy-database-server for all published Fact Statements.

## Local Development

1. Clone this repository
2. Get a local version of PocketBase running on your machine by following the [docs](https://pocketbase.io/docs/)
3. Setup base collections in pocketbase (will be included in repo soon)
4. Create an `.env` file in the root of the project based on the `.env.example` file
5. Add the `DB_EMAIL`, and `DB_PASSWORD`, values to the `.env` file which are the email and password you chose for the the admin of your local Pocketbase instance (`DB_HOST` can remain the same as in the `.env.example`).
6. Run `docker-compose up --build` to build the Docker image and start the development container
