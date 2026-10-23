# Server messages in Twi and Ga

The site's own text is translated in `frontend/messages` (see the README
there). This folder is for the messages the API sends back, which the site
shows as they arrive: "That code is not correct.", "Add at least one course."
and so on. They are marked in the code with `gettext` (`_("...")`).

Django's standard tools, which need GNU gettext (`sudo apt install gettext`).
From `backend/`:

```bash
python manage.py makemessages -l tw -l gaa --ignore=.venv
```

That writes `locale/tw/LC_MESSAGES/django.po` and the Ga one: every message,
with an empty `msgstr` to fill in. Any `.po` editor works (Poedit is free), or
a text editor. Keep `%(name)s`-style placeholders exactly as they are.

```bash
python manage.py compilemessages --ignore=.venv
```

turns them into the `.mo` files Django reads. `deploy.sh` does this on the
server whenever this folder holds a `.po`. A message left empty stays English.

Re-run `makemessages` after code changes to pick up new messages; it keeps
what is already translated.

The API only speaks a language listed in `INTERFACE_LANGUAGES` in
`backend/.env`, and only on `/api/`: the back office stays in English. See
`core/middleware.py`.
