# Security

- The first login is `admin` / `admin`; you are asked to choose your own credentials straight away. Do this before exposing the app to the internet.
- Put the app behind HTTPS (reverse proxy). Never use `run-dev` (no login) on a server.
- Keep `.env` / `stack.env` (SMTP password, API keys) out of git; they are in `.gitignore`.

Report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on the repository, not in a public issue.
