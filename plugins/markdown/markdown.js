/*
 * Markdown, turned into what the place it is going actually reads.
 *
 * Every model writes markdown. Almost nowhere renders it. Slack reads
 * *mrkdwn*, which looks like markdown and is not: one asterisk means bold
 * rather than italic, a link is `<url|text>` rather than `[text](url)`, and
 * there are no headings at all. So a perfectly good answer posted straight
 * into a channel arrives wearing its own punctuation — `**like this**` — and
 * the reader sees the asterisks.
 *
 * That is a string transformation and nothing else: this plugin reaches
 * nothing, asks for no capability and no permission, and cannot fail because
 * somebody's API moved.
 *
 * ## Why it is hand-written rather than a library
 *
 * There is no markdown-to-mrkdwn library worth bundling — the ones that exist
 * are regex a page long, and the hard parts are not the ones a parser helps
 * with. What actually matters is *what not to touch*: an asterisk inside a
 * code span is an asterisk, a URL inside a link is not text, and a fenced
 * block is literal to its last character. So the conversion below lifts those
 * out first, transforms what is left, and puts them back — which is the whole
 * trick, and is clearer here than it would be behind a dependency.
 *
 * ## What Slack cannot do, and what becomes of it
 *
 * Headings become bold lines, because mrkdwn has no headings. Tables become
 * their rows as plain lines, because mrkdwn has no tables. Images become the
 * link they point at. A fence's language tag is dropped, because Slack shows
 * it as the first line of the code otherwise. Nothing is silently deleted:
 * what cannot be styled is left readable.
 *
 * Licensed under the Apache License, Version 2.0.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The character a lifted-out piece is parked under.
 *
 * A control character, because it is the one thing that cannot occur in
 * anybody's markdown by accident — a placeholder built out of letters could
 * be written by the text it is protecting.
 */
const MARK = '\u0000';

/** Lifts pieces out of the text so nothing below rewrites their insides. */
function protector() {
  const held = [];
  return {
    /** Parks `text` and answers the placeholder standing in for it. */
    park(text) {
      held.push(text);
      return `${MARK}${held.length - 1}${MARK}`;
    },
    /**
     * Puts every parked piece back where its placeholder stands.
     *
     * Repeatedly, because a parked piece can hold a placeholder of its own —
     * bold wrapping a code span parks the code first and then parks the bold
     * around the marker — so one pass would leave the inner one showing.
     */
    restore(text) {
      let written = text;
      const pattern = new RegExp(`${MARK}(\\d+)${MARK}`, 'g');
      for (let pass = 0; pass < 10 && written.includes(MARK); pass++) {
        written = written.replace(pattern, (whole, index) => held[Number(index)] ?? '');
      }
      return written;
    },
  };
}

/** The entities a markdown writer may have typed, decoded for plain text. */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * The three things Slack reads as markup, escaped so text cannot become one.
 *
 * Done before anything is built, so the `<` in "a < b" stays a less-than and
 * does not open a link that swallows the rest of the message.
 */
function escaped(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A table row split into its cells, with the pipes and padding gone. */
function cellsOf(line) {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** Whether a line is a table's `|---|:--:|` separator rather than content. */
function isRule(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

/**
 * Markdown as Slack's mrkdwn.
 *
 * The order is the whole of it: fences, then inline code, then links — each
 * lifted out and parked — and only then the emphasis, which is the pass that
 * would otherwise chew through a URL or a code span.
 */
function toSlack(markdown) {
  const parked = protector();
  let text = String(markdown).replace(/\r\n?/g, '\n');

  /*
   * Fenced blocks first and whole. The language tag goes: Slack has no
   * highlighting to give it to, and shows it as the code's first line.
   */
  text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (whole, code) =>
    parked.park('```\n' + escaped(code.replace(/\n$/, '')) + '\n```'),
  );
  /* An unterminated fence is still a fence to the end of the message. */
  text = text.replace(/```[^\n]*\n([\s\S]*)$/, (whole, code) =>
    parked.park('```\n' + escaped(code) + '\n```'),
  );

  /* Then inline code, which protects whatever punctuation is inside it. */
  text = text.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1/g, (whole, ticks, code) =>
    parked.park('`' + escaped(code) + '`'),
  );

  /*
   * Then links and images, parked already converted: the url must not meet
   * the emphasis pass, and `[text](url)` and `![alt](url)` differ only in
   * what Slack should show for them.
   */
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (whole, alt, url) =>
    parked.park(alt.trim().length > 0 ? `<${url}|${escaped(alt)}>` : `<${url}>`),
  );
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (whole, label, url) =>
    parked.park(`<${url}|${escaped(toSlackInline(label, parked))}>`),
  );
  /* A bare <https://…> is already Slack's own spelling; keep it from escaping. */
  text = text.replace(/<((?:https?|mailto):[^>\s]+)>/g, (whole, url) => parked.park(`<${url}>`));

  /* Everything remaining is text, so it is safe to escape all at once. */
  text = escaped(text);

  const lines = text.split('\n');
  const written = [];
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];

    /* A table's separator row carries no content, and its cells become lines. */
    if (isRule(line) && written.length > 0) {
      continue;
    }
    if (line.includes('|') && /^\s*\|/.test(line)) {
      written.push(cellsOf(line).join('  '));
      continue;
    }

    /* Headings: bold, because mrkdwn has none. */
    line = line.replace(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/, (whole, hashes, said) =>
      said.trim().length > 0 ? parked.park(`*${toSlackInline(said.trim(), parked)}*`) : '',
    );

    /* Rules: a line, because three hyphens on their own read as nothing. */
    line = line.replace(/^\s{0,3}([-*_])(\s*\1){2,}\s*$/, '──────────');

    /* Bullets: the character Slack's own lists use, with the nesting kept. */
    line = line.replace(/^(\s*)[-*+]\s+/, (whole, indent) => `${indent}•  `);
    /* Ordered items keep their number; only the spacing is made even. */
    line = line.replace(/^(\s*)(\d+)[.)]\s+/, (whole, indent, number) => `${indent}${number}.  `);

    written.push(toSlackInline(line, parked));
  }

  return parked.restore(written.join('\n'));
}

/**
 * The emphasis pass, on one line's worth of already-protected text.
 *
 * Double before single, always: `**bold**` has to become `*bold*` before
 * anything looks at a lone asterisk, or the second pass eats the first one's
 * output and the text comes out italic and full of stray markers.
 */
function toSlackInline(text, parked) {
  let held = text;

  /*
   * What the double markers become is *parked*, not written back into the
   * line. Slack's bold is a single asterisk, which is markdown's italic —
   * so `*bold*` left in the text is indistinguishable from something the
   * italic pass below should rewrite, and that pass would turn the bold it
   * just made into `_bold_`. Parking it puts it out of reach.
   *
   * The contents go round again on the way in, so emphasis nested inside
   * emphasis is converted rather than frozen.
   */
  const bold = (whole, inner) => parked.park(`*${toSlackInline(inner, parked)}*`);
  /* ***both*** — Slack has no combined form, so it reads as bold. */
  held = held.replace(/\*\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*\*/g, bold);
  held = held.replace(/\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*/g, bold);
  held = held.replace(/__(?!\s)([\s\S]+?)(?<!\s)__/g, bold);
  /* ~~struck~~ loses a tilde; Slack spells it with one. */
  held = held.replace(/~~(?!\s)([\s\S]+?)(?<!\s)~~/g, (whole, inner) =>
    parked.park(`~${toSlackInline(inner, parked)}~`),
  );

  /* Whatever marker is left was single, and single emphasis is an underscore. */
  held = held.replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '$1_$2_');
  held = held.replace(/(^|[^_\w])_(?!\s)([^_\n]+?)(?<!\s)_(?!_)/g, '$1_$2_');
  return held;
}

/** Markdown with its markup taken off, for somewhere that renders nothing at all. */
function toText(markdown) {
  let text = String(markdown).replace(/\r\n?/g, '\n');

  text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (whole, code) => code.replace(/\n$/, ''));
  text = text.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1/g, (whole, ticks, code) => code);
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (whole, alt, url) =>
    alt.trim().length > 0 ? `${alt} (${url})` : url,
  );
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (whole, label, url) => `${label} (${url})`);
  text = text.replace(/<((?:https?|mailto):[^>\s]+)>/g, '$1');

  const written = [];
  for (const line of text.split('\n')) {
    if (isRule(line)) {
      continue;
    }
    let held = line;
    held = held.replace(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/, '$1');
    held = held.replace(/^\s{0,3}([-*_])(\s*\1){2,}\s*$/, '');
    held = held.replace(/^(\s*)[-*+]\s+/, '$1• ');
    held = held.replace(/^\s*>\s?/, '');
    if (held.includes('|') && /^\s*\|/.test(held)) {
      held = cellsOf(held).join('  ');
    }
    held = held.replace(/\*\*\*([\s\S]+?)\*\*\*/g, '$1');
    held = held.replace(/\*\*([\s\S]+?)\*\*/g, '$1');
    held = held.replace(/~~([\s\S]+?)~~/g, '$1');
    held = held.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, '$1$2');
    held = held.replace(/(^|[^_\w])_([^_\n]+?)_(?!_)/g, '$1$2');
    held = held.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X'
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    });
    written.push(held);
  }
  return written.join('\n');
}

export default class Markdown extends OrknuxPlugin {

  id() {
    return 'markdown';
  }

  apiVersion() {
    return 1;
  }

  parameters() {
    return [];
  }

  permissions() {
    return [];
  }

  capabilities() {
    // None, and none possible: this is string in, string out.
    return [];
  }

  /* The agents' surface: both, because a model writes markdown without being asked to. */
  /*
   * Where the asterisks come from.
   *
   * A model writes markdown because markdown is what writing looks like. Slack
   * reads mrkdwn, which is near enough to look the same and different enough
   * that \`**bold**\` arrives with its asterisks showing - and the model cannot
   * see the message it sent, so nothing corrects it.
   *
   * The slack plugin's own skill says to run text through \`toSlack\` before
   * \`slack_post\`. That covers the case with a call in it. It does not cover
   * the commoner one: an agent answering in a thread, whose reply is posted as
   * it stands, with no call anywhere to convert it. That is what this is for.
   */
  skills() {
    return [
      new OrknuxSkill({
        name: 'Writing so Slack reads it',
        description: 'Why a message arrives full of asterisks, and the two different fixes.',
        content: `# Writing so Slack reads it

Slack does not read markdown. It reads **mrkdwn**, which looks near enough to
be mistaken for it and is not, so a message written as markdown arrives with
its punctuation showing:

    what you wrote          what the reader sees
    **orknux-server**       **orknux-server**
    * a bullet              * a bullet
    [docs](https://x.com)   [docs](https://x.com)
    # A heading             # A heading

You cannot see the message you sent, so nothing tells you this happened.

## Which fix depends on how your text gets there

**If you are calling \`slack_post\`** - run what you composed through
\`markdown_toSlack\` first and post the result. One call, and it handles
everything:

    markdown_toSlack("**bold**, a [link](https://x.com), and:\n* one\n* two")
      ->  "*bold*, a <https://x.com|link>, and:\n•  one\n•  two"

**If your reply is posted as it stands** - you are answering in a thread and
what you write goes to the channel verbatim - then there is no call to convert
through. **Write mrkdwn directly.** This is the case that catches people,
because there is no tool involved to remind you.

## mrkdwn, in full

| you want | write | not |
|---|---|---|
| bold | \`*bold*\` | \`**bold**\` |
| italic | \`_italic_\` | \`*italic*\` |
| strikethrough | \`~struck~\` | \`~~struck~~\` |
| a link | \`<https://x.com|text>\` | \`[text](https://x.com)\` |
| a bullet | \`•\` and a space, or \`-\` | \`*\` |
| code | \`\`code\`\` | the same - backticks are backticks |
| a heading | a bold line | \`#\` |
| a quote | \`>\` | the same |

**There are no headings and no tables.** A \`#\` line is literal text. Make a
heading a bold line on its own; make a table a short list, because a table in
a phone-width message is unreadable whatever the syntax.

## Somewhere that renders nothing

\`markdown_toText\` is the other direction: emphasis gone, links become
\`text (url)\`, headings become their words, code keeps its content. For an email
subject, a commit message, a log line, a webhook field - anywhere the
punctuation would be read as punctuation.

## One habit worth keeping

Write the message, then ask where it is going, then convert or compose
accordingly. Deciding afterwards is how \`**bold**\` reaches a channel: the text
was already written and the thought was already elsewhere.`,
      }),
    ];
  }

  tools() {
    return [
      new OrknuxFunctionTool({ function: 'toSlack' }),
      new OrknuxFunctionTool({ function: 'toText' }),
    ];
  }

  functions() {
    return [
      new OrknuxFunction({
        name: 'toSlack',
        description:
          'Turns markdown into Slack mrkdwn, which is what a Slack message actually reads. Run ' +
          'anything you wrote as markdown through this before slack_post, or the reader sees your ' +
          'asterisks instead of bold text. **bold** becomes *bold*, *italic* becomes _italic_, ' +
          '[text](url) becomes <url|text>, headings become bold lines and tables become their rows - ' +
          'mrkdwn has neither. Code spans and fences are left exactly as they are.',
        params: [{ name: 'markdown', type: 'string' }],
        returnType: 'string',
        run: (markdown) => (typeof markdown === 'string' ? toSlack(markdown) : ''),
      }),

      new OrknuxFunction({
        name: 'toText',
        description:
          'Strips markdown down to plain readable text, for somewhere that renders nothing at all - ' +
          'an email subject, a commit message, a log line, a webhook field. Emphasis markers go, ' +
          'links become "text (url)", headings become their words, and code keeps its content ' +
          'without the backticks.',
        params: [{ name: 'markdown', type: 'string' }],
        returnType: 'string',
        run: (markdown) => (typeof markdown === 'string' ? toText(markdown) : ''),
      }),
    ];
  }
}
