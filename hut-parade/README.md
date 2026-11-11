# Hut-Parade

Eine Seitenleiste für Claude Code, die jeden Agent und Sub-Agent anzeigt, den Claude startet.
Jeder Helfer erscheint als orangenes Maskottchen mit einem farbigen Hut, der seine Aufgabe zeigt:

- 🔵 Recherche: Detektivmütze mit Lupe
- 🟣 Design: Barett mit Stift
- 🟢 Coding: Bauhelm
- 🟡 Planung: Zylinder
- 🔴 Review & Tests: Feuerwehrhelm
- ⚪ Sonstiges: Mütze

Die Agents stehen untereinander. Rechts neben jedem Maskottchen steht, was er gerade tut
(zum Beispiel „liest register.tsx“ oder „sucht im Web …“), dazu Laufzeit, Zahl der Schritte,
die letzten Schritte und der Auftrag. Fertige Agents wandern klein in die Liste „Erledigt“.

`/hats` öffnet die Leiste wieder, falls sie geschlossen wurde. In der Desktop-App wird das
Maskottchen als SVG gezeichnet, im Terminal als Emoji.
