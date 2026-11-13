# Publishing checklist

What is already in the repo: GPL-3.0 `LICENSE`, `README.md`, `CHANGELOG.md`, `SECURITY.md`, the image workflow (`.github/workflows/docker.yml`), the release workflow (`release.yml`) and the landing page (`docs/` + `pages.yml`).

## One-time settings on GitHub (cannot be done from the repo)
1. **Settings → Pages → Source: GitHub Actions.** The page appears at https://sbarrak.github.io/electricityfinland/.
2. **About (gear icon on the repo home page):**
   - Description: `Self-hosted monitor for Finnish electricity spot prices (Nord Pool, 15-min), price estimates, wind and weather, with WhatsApp / email alarms. Docker / NAS.`
   - Website: the Pages URL above.
   - Topics: `electricity` `electricity-prices` `spot-price` `nord-pool` `finland` `finnish` `suomi` `pörssisähkö` `energy` `wind-power` `fingrid` `docker` `docker-compose` `synology` `portainer` `self-hosted` `home-automation` `price-alerts` `whatsapp` `dashboard` `fastapi`
3. **Packages:** set `electricityfinland-app` and `electricityfinland-setup` to *Public* after the first image build.
4. **Settings → Social preview:** upload `docs/img/c-signal-desktop.jpg`.
5. **Settings → Code security:** enable private vulnerability reporting.

## Release
```sh
git checkout main && git pull
git tag v1.0.0 && git push origin v1.0.0
```
This builds `ghcr.io/sbarrak/electricityfinland-{app,setup}:v1.0.0` and creates the GitHub Release with generated notes. Update `CHANGELOG.md` first.

## Findability
- Search engines: add the Pages URL in Google Search Console and submit `sitemap.xml`.
- Share in Finnish communities (e.g. Kotiautomaatio, r/Suomi, Home Assistant forum) with a screenshot and the Docker one-liner.
