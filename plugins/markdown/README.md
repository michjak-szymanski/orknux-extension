# Markdown

Every model writes markdown. Almost nowhere renders it.

Slack reads *mrkdwn*, which looks like markdown and is not: one asterisk means
bold rather than italic, a link is `<url|text>` rather than `[text](url)`, and
there are no headings at all. So a perfectly good answer posted straight into a
channel arrives wearing its own punctuation — `**like this**` — and the reader
sees the asterisks.

This is the conversion, and it is a string transformation and nothing else: no
capability, no permission, nothing to reach and nothing to break.

| Function | |
|----------|---|
| `toSlack(markdown)` | Markdown as Slack mrkdwn. Run anything you wrote through this before `slack_post`. |
| `toText(markdown)` | Markdown stripped to plain readable text, for an email subject, a commit message, a log line. |

## What the conversion actually gets right

The easy part is `**bold**` becoming `*bold*`. The hard part is *what not to
touch* — an asterisk inside a code span is an asterisk, a URL inside a link is
not text, and a fenced block is literal to its last character. So fences,
inline code and links are lifted out and parked before anything else runs, and
put back at the end. That ordering is the whole trick.

The other ordering that matters is double emphasis before single: `**bold**`
has to become `*bold*` before anything looks at a lone asterisk, or the second
pass eats the first one's output and the text comes back italic and full of
stray markers.

`<`, `>` and `&` are escaped before any markup is built, so the `<` in "a < b"
stays a less-than instead of opening a link that swallows the rest of the
message.

## What Slack cannot do, and what becomes of it

Headings become bold lines and tables become their rows as plain lines, because
mrkdwn has neither. Images become the link they point at. A fence's language
tag is dropped, because Slack shows it as the code's first line otherwise.
Nothing is silently deleted: what cannot be styled is left readable.

## Why it is hand-written rather than bundled

There is no markdown-to-mrkdwn library worth the dependency — the ones that
exist are a page of regex, and the hard parts above are not the ones a parser
helps with. The conversion is clearer here than it would be behind an import.
