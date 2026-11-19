---
name: summarise-document
description: Use when asked to read a document at a URL or path and write a summary into docs/knowledge/.
---
<!--
JSPARK Forge skill template. Copy to skills/<name>/SKILL.md, then replace the example below. One task per skill.
Write in the imperative, second person. Run `forge.js lint` on the file before you use it.

- name: the folder name of the skill, lower case with hyphens.
- description: one line that states the trigger, and must start with "Use when".
- Numbered parts: each part names its Input, its Action and its Output (a name or a path).
- A fetched or generated artifact: skip its part if the output already exists.
- Output names never overwrite: check that the name is free, and if it is taken, stop and say so.
- Last part: "Verify:" with "Evidence:", the check that ran and the output that proves it.
-->
1. Input: the URL or path. Action: normalise it to a cache key. Output: the key.
2. Input: the key. Action: if `.cache/<key>/` exists, skip; else fetch and unpack there. Output: `.cache/<key>/`.
3. Input: the cache folder. Action: find the entry file; read it and the files it includes. Output: notes (not written).
4. Input: the notes. Action: write `docs/knowledge/summary-<tag>.md`; if it exists, stop and say so. Output: the path.
5. Verify: the file exists, is under 600 words, and quotes one source line with its location.
   Evidence: the word count and the quoted line with its path.
