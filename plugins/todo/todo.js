/*
 * A todo list, as a plugin — the agent's own, not the user's.
 *
 * A model working a long job holds its plan in its context, and a context is
 * the one thing a long job erodes: steps blur, done and not-done trade places,
 * and the last item quietly falls off. The fix people use is a list on paper,
 * and the session store is exactly that shape — what one tool call puts, a
 * later one gets, for the length of the conversation and never beyond it. So
 * this plugin is five small verbs around one stored list, and the real work is
 * in the descriptions: they are written to make a model *reach* for the list
 * the moment a request is complex enough to split — break it into tasks first,
 * work them one by one, note what it learns, complete as it goes, and check
 * the remaining count before calling anything finished.
 *
 * Nothing here needs granting. The session store is not a capability — nothing
 * outside the session is reached by it — and no other session ever sees the
 * list. Where there is no session at all (a workflow calling `todo_add`, a
 * test), the store answers with the server's own sentence about that, and the
 * sentence is thrown rather than a list quietly dropped; `list` alone answers
 * empty, because an empty list is the truth of nothing stored.
 *
 * The list itself: tasks in working order, each with an id that never changes,
 * a title, a done flag, and notes — findings, decisions, blockers — appended
 * as the work teaches them. Reordering is by ids, and naming just one id is
 * how one urgent task moves to the front.
 *
 * Licensed under the Apache License, Version 2.0.
 * SPDX-License-Identifier: Apache-2.0
 */

/** The one key this plugin keeps in the session store. */
const KEY = 'todo';

/**
 * The stored list, or a fresh one where nothing is stored — or where what is
 * stored is not a list, because the store outlives any one version of this
 * file and an old shape should reset rather than throw.
 */
function loaded() {
  const kept = orknux.session.store.get(KEY);
  if (kept === null || typeof kept !== 'object' || !Array.isArray(kept.tasks) || typeof kept.next !== 'number') {
    return { next: 1, tasks: [] };
  }
  return kept;
}

/** The list stored back, or the store's own sentence about why not, thrown. */
function saved(list) {
  const kept = orknux.session.store.put(KEY, list);
  if (kept !== null && typeof kept === 'object' && typeof kept.error === 'string') {
    throw new Error(`could not keep the list: ${kept.error}`);
  }
}

/** One task by its id, or the sentence naming what is not there. */
function taskOf(list, id) {
  const found = list.tasks.find((one) => one.id === id);
  if (found === undefined) {
    throw new Error(`there is no task ${id}`);
  }
  return found;
}

/** The list as every function answers it: the tasks, and what remains. */
function answered(list) {
  return {
    tasks: list.tasks.map((one) => ({
      id: one.id,
      title: one.title,
      done: one.done,
      notes: one.notes,
    })),
    remaining: list.tasks.filter((one) => one.done !== true).length,
  };
}

export default class Todo extends OrknuxPlugin {

  id() {
    return 'todo';
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
    // None: the session store is not a capability, and nothing else is
    // touched. The list never leaves the session it was written in.
    return [];
  }

  /*
   * The page that says when to reach for the list at all.
   *
   * The tool descriptions can say what each verb does; they are read one at a
   * time, at the moment of calling, by a model that has already decided to
   * call something. The decision this plugin exists to change happens earlier
   * than that — before the first step, when a request has just arrived and is
   * about to be answered in one go — and a skill is the only surface that is
   * read then.
   */
  skills() {
    return [
      new OrknuxSkill({
        name: 'Planning work before starting it',
        description:
          'When a request is too big to hold in your head, and what to do about it before you begin.',
        content: `# Planning work before starting it

Long jobs fail in a particular way. Not at the hard step — at the fourth easy
one, where the plan you were holding has quietly lost an item, and nobody
notices because the answer still reads as confident.

The fix is the one people use: write the list down first.

## When to write one

Write a list **before the first step** when any of these is true:

- the request has more than one deliverable in it
- you cannot say, in one sentence, what "done" means
- it will take more than a couple of tool calls
- you are about to change several files, several tickets, or several places
- somebody asked for "everything" of something, or for an audit, or a sweep

If none of those hold, do not write a list. A two-step job with a list is
ceremony, and ceremony teaches whoever reads the transcript to skim.

## How to write one

\`todo_add(titles)\` takes an array, in the order the work should go. Titles are
outcomes, not activities: *"Slack plugin uploads a PDF"* is checkable and
*"look at the Slack plugin"* is not.

Split by what could fail separately. Three tasks that must all succeed or all
be undone are one task. One task you would report on separately is one task.

## How to work one

Work the list top to bottom, and one at a time. Between steps:

- **\`todo_note(task, text)\`** when you learn something the next person needs —
  a decision and why, a blocker, the reason an obvious approach does not work.
  Notes accumulate; you are writing to whoever picks this up, which is usually
  a later you with less context.
- **\`todo_complete(task)\`** the moment a task is actually finished, not in a
  batch at the end. The remaining count is how anybody reads the state of the
  job, including you.
- **\`todo_add\`** again when new work surfaces. It usually does. Adding it is
  not an admission of a bad plan; not adding it is how things get dropped.
- **\`todo_reorder(order)\`** when something becomes urgent. Passing one id
  moves that task to the front and leaves everything else in order.

## Before you say you are done

Call \`todo_list()\` and look at \`remaining\`. If it is above zero, the work is
not finished, whatever the last thing you did felt like. Either finish those
tasks or say plainly which ones you are not doing and why.

## What this list is not

It is yours, not the user's. It is the plan you would otherwise hold in your
head, and it lives exactly as long as this conversation. Do not put the user's
own todos in it, do not use it to take notes that belong in your answer, and do
not narrate it step by step — the point is that the work comes out right, not
that the list is visible.`,
      }),
    ];
  }

  /* The list, and one task of it. */
  objects() {
    return [
      new OrknuxObject({
        name: 'Task',
        description: 'One item on the list.',
        properties: [
          {
            name: 'id',
            kind: 'number',
            description: 'Assigned once and never changed — reordering does not renumber anything.',
          },
          { name: 'title', kind: 'string', description: 'The outcome, not the activity.' },
          { name: 'done', kind: 'boolean', description: 'Whether it has been completed.' },
          {
            name: 'notes',
            kind: 'array',
            of: 'string',
            description: 'Findings, decisions and blockers, oldest first. Nothing is ever overwritten.',
          },
        ],
      }),

      new OrknuxObject({
        name: 'List',
        description: 'The whole list as it stands.',
        properties: [
          { name: 'tasks', kind: 'array', of: 'Task', description: 'In working order.' },
          {
            name: 'remaining',
            kind: 'number',
            description: 'How many are not done. Above zero means the job is not finished.',
          },
        ],
      }),
    ];
  }

  /* The agents' surface, which is the whole point of this plugin: all five verbs, fronted. */
  tools() {
    return [
      new OrknuxFunctionTool({ function: 'add' }),
      new OrknuxFunctionTool({ function: 'list' }),
      new OrknuxFunctionTool({ function: 'reorder' }),
      new OrknuxFunctionTool({ function: 'note' }),
      new OrknuxFunctionTool({ function: 'complete' }),
    ];
  }

  functions() {
    return [
      new OrknuxFunction({
        name: 'add',
        description:
          'Your todo list for this conversation - use it as your working plan. When a request is ' +
          'complex, has several parts, or will take more than a couple of steps, break it into tasks ' +
          'here FIRST and then work them one by one: it keeps a long job on rails, and the user sees ' +
          'where things stand. Pass the titles as an array of strings, in the order the work should ' +
          'go; call again whenever new work surfaces mid-job. Answers the whole list with each ' +
          'task\'s id.',
        params: [{ name: 'titles', type: 'array' }],
        returnType: 'List',
        run: (titles) => {
          const named = (Array.isArray(titles) ? titles : [])
            .filter((one) => typeof one === 'string')
            .map((one) => one.trim())
            .filter((one) => one.length > 0);
          if (named.length === 0) {
            throw new Error('there are no tasks to add: pass an array of task titles');
          }

          const list = loaded();
          for (const title of named) {
            list.tasks.push({ id: list.next, title: title, done: false, notes: [] });
            list.next += 1;
          }
          saved(list);
          return answered(list);
        },
      }),

      new OrknuxFunction({
        name: 'list',
        description:
          'The todo list as it stands: every task with its id, title, done flag and notes, and how ' +
          'many remain. Check it when coming back to a long job, when choosing what to do next, and ' +
          'before declaring the work finished - a remaining count above zero is unfinished work. ' +
          'Empty when nothing was ever added.',
        params: [],
        returnType: 'List',
        run: () => answered(loaded()),
      }),

      new OrknuxFunction({
        name: 'reorder',
        description:
          'Puts the todo list in a new working order. Pass task ids in the order the work should now ' +
          'go; tasks left unmentioned keep their order after the ones named - so moving one urgent ' +
          'task to the front is passing just its id. Answers the whole list, reordered.',
        params: [{ name: 'order', type: 'array' }],
        returnType: 'List',
        run: (order) => {
          const asked = Array.isArray(order) ? order : [];
          if (asked.length === 0) {
            throw new Error('there is no order to apply: pass an array of task ids');
          }

          const list = loaded();
          const fronted = [];
          for (const id of asked) {
            const found = taskOf(list, id);
            if (!fronted.includes(found)) {
              fronted.push(found);
            }
          }
          const rest = list.tasks.filter((one) => !fronted.includes(one));
          list.tasks = fronted.concat(rest);
          saved(list);
          return answered(list);
        },
      }),

      new OrknuxFunction({
        name: 'note',
        description:
          'Adds a note to one task: a finding, a decision, a blocker, where the work stopped - what ' +
          'whoever picks the task up needs to know. Notes accumulate; nothing is overwritten. Pass ' +
          'the task\'s id and the note. Answers the task with all its notes.',
        params: [
          { name: 'task', type: 'number' },
          { name: 'text', type: 'string' },
        ],
        returnType: 'Task',
        run: (task, text) => {
          const said = typeof text === 'string' ? text.trim() : '';
          if (said.length === 0) {
            throw new Error('there is no note to add');
          }

          const list = loaded();
          const found = taskOf(list, task);
          found.notes.push(said);
          saved(list);
          return { id: found.id, title: found.title, done: found.done, notes: found.notes };
        },
      }),

      new OrknuxFunction({
        name: 'complete',
        description:
          'Marks one task done. Do it as each task finishes rather than in a batch at the end - the ' +
          'remaining count is how the state of the job is read. Where the outcome is worth keeping, ' +
          'add a note first. Already-done counts as done. Answers the whole list.',
        params: [{ name: 'task', type: 'number' }],
        returnType: 'List',
        run: (task) => {
          const list = loaded();
          taskOf(list, task).done = true;
          saved(list);
          return answered(list);
        },
      }),
    ];
  }
}
