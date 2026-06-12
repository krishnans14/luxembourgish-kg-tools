# Manual transcripts

For episodes whose transcript is behind the INLL Learning Space guest login
(https://learningspace.inll.lu/course/view.php?id=5497 → "access as guest").

## Workflow

1. `python build_episodes.py` — it prints the episodes missing a transcript
   and the exact filename to create (e.g. `transcripts/e3k7it7.txt`).
2. Open the Learning Space as guest, copy the transcript text.
3. Paste into `transcripts/<id>.txt` — plain text, line breaks as you like.
4. `python build_episodes.py` again → regenerates `episodes.js`.
5. `git add . && git commit -m "transcript <id>" && git push` — done.

A manual file also *overrides* an RSS transcript with the same id, so you can
use it to fix typos in older episodes too.
