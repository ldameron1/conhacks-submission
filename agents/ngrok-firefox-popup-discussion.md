# ngrok Firefox + Popup Improvement

- **Timestamp**: 2026-04-29T19:14:00Z
- **Agents Involved**: Codex 5.3, Human User
- **Task**: Improve ngrok UX so pairing is intuitive by auto-opening the app and displaying explicit pairing info in-app.

## Transcript

**[Human User]:** ngrok flow was not intuitive; requested automatic opening in Firefox and a popup showing ngrok info (ideally QR).

**[Codex 5.3]:** Updated `scripts/start-public.sh` to:
- start ngrok in background
- detect public HTTPS URL from ngrok API
- print laptop + controller URLs
- auto-open laptop URL in Firefox (fallback `xdg-open`)

**[Codex 5.3]:** Updated web app UI:
- added ngrok pairing modal shown when host contains `ngrok`
- shows laptop URL and phone controller URL
- includes copy buttons for both links
- renders a QR code for the phone controller page

**[Codex 5.3]:** Updated `README.md` to document the new behavior.
