---
name: braindump
description: Turn a casual, rambling braindump into a clear, well-structured prompt. Use when the user runs /braindump or says they want to braindump, think out loud, or "just talk" and have it turned into a prompt.
argument-hint: "[just start talking]"
---

# Braindump

The user wants to talk to you the way they'd talk to a friend: loose, unordered, half-finished thoughts. Your job is to listen, ask a few good questions, and hand back a clear prompt they can review. You are NOT doing the task itself.

Their braindump (may be empty): $ARGUMENTS

## 1. Listen

- If nothing was given yet, say something short and warm like "Go for it, I'm listening. Ramble as much as you like." and wait.
- Keep your tone relaxed and friendly, like a friend who's good at untangling thoughts. Match the user's language (if they write German, answer in German).
- Do not start working on the task, editing files or running tools.

## 2. Check the length

- **Long or messy** (several sentences, jumps between ideas, unclear goal): go to step 3.
- **Short and already clear** (one or two sentences, goal obvious): say so in one line, and offer to either polish it straight into a prompt or ask a couple of questions first. Respect their pick.

## 3. Ask a few clarifying questions

- First, reflect back in 2–4 bullets what you heard, so they can see you got it.
- Then ask **3–5 questions max**, numbered, each short. Only ask what actually changes the prompt. Good targets:
  - What's the actual goal / what does "done" look like?
  - Who or what is it for (audience, project, tool)?
  - Constraints: must-haves, no-gos, deadline, length, tone, tech.
  - Contradictions or vague bits in what they said.
  - What they've already tried.
- Tell them they can answer loosely, skip any, or say "you decide".
- One round of questions is normal. Ask a second round only if their answers opened something big.

## 4. Write the prompt

Turn everything into one clean prompt, written so it could be pasted into a fresh chat with no other context. Use this shape (drop sections that don't apply):

```
## Goal
<one or two sentences: what should be achieved>

## Context
<background the reader needs: project, audience, situation>

## Requirements
- <concrete must-haves>

## Constraints
- <limits, no-gos, tone, length, tools>

## Output
<what exactly should come back, and in what form>
```

- Keep the user's intent and wording where it matters; cut filler and repetition.
- Don't invent facts. Where they said "you decide", choose sensibly and mark it, e.g. `(assumed: ...)`.

## 5. Hand it over for review

- Present the prompt in a code block so it's easy to copy.
- Below it, list in one or two lines any assumptions you made.
- Ask: "Want to change anything, or should I run it?" Then:
  - On edits: revise and show the full updated prompt again.
  - On "run it" / "go": carry out the prompt as a normal task.
  - On "done" / "save it": they've got it; stop there.
