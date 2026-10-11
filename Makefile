.DEFAULT_GOAL := help

.PHONY: run stop logs help

run:
	@docker compose up -d --wait

stop:
	@docker compose stop

logs:
	@docker compose logs --follow api web db

help:
	@printf '%s\n' \
	  'make run   Start Docker Compose detached and wait for healthy services.' \
	  'make stop  Stop services without removing containers or volumes.' \
	  'make logs  Follow API, web, and database logs (Ctrl-C to exit).' \
	  'make help  Show this help (no Docker or credentials required).' \
	  'Before startup: copy config/development.example to .env only if absent; fill in local credentials.'
