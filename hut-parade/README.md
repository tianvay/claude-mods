# Hut-Parade

Eine Seitenleiste für Claude Code, die jeden Agent und Sub-Agent anzeigt, den Claude startet.
Jeder Helfer erscheint als orangenes Maskottchen. Der farbige Hut zeigt die Art der Aufgabe:

- 🔵 Recherche: Detektivmütze
- 🟣 Design: Barett
- 🟢 Coding: Bauhelm
- 🟠 Übersetzung: Fes mit Quaste
- 🟤 Texte: Hut mit Presseausweis
- 🟡 Planung: Zylinder
- 🔴 Review & Tests: Feuerwehrhelm
- ⚫ Git & Betrieb: Kapitänsmütze
- ⚪ Sonstiges: Mütze

In der Hand hält das Maskottchen ein Accessoire, das genauer zur Aufgabe passt. Es richtet sich
nach der Kurzbeschreibung des Agents, zum Beispiel:

| Aufgabe enthält … | Accessoire |
| --- | --- |
| übersetzen, translate, i18n | Sprechblasen EN/DE |
| Test | Reagenzglas |
| Bug, Fehler, fix | Käfernetz |
| Git, Commit, Branch, Merge | Verzweigung |
| Deploy, Release, veröffentlichen | Rakete |
| Build, Paket, Install | Paket |
| Daten, Datenbank, SQL, CSV, JSON | Datenbank |
| Web, Webseite, URL | Globus |
| Doku, Docs, README, lesen | Buch |
| Farbe, Style, CSS, Theme | Farbpalette |
| implementieren, Feature, Komponente | Laptop |
| Review, prüfen, Audit | Klemmbrett |
| Plan, Roadmap, Konzept | Landkarte |
| Text, Artikel, E-Mail, zusammenfassen | Schreibfeder |
| suchen, untersuchen, recherchieren | Lupe |

Passt nichts davon, bekommt jeder Hut sein Standard-Accessoire: Lupe, Bleistift,
Schraubenschlüssel, Sprechblasen, Schreibfeder, Landkarte, Klemmbrett, Steuerrad oder Kaffeetasse.
Bricht ein Agent ab, sitzt sein Hut schief und das Accessoire liegt auf dem Boden.

Die Agents stehen untereinander. Rechts neben jedem Maskottchen steht, was er gerade tut
(zum Beispiel „liest register.tsx“ oder „sucht im Web …“), dazu Laufzeit, Zahl der Schritte,
die letzten Schritte und der Auftrag. Fertige Agents wandern klein in die Liste „Erledigt“.

Ein Agent erscheint erst, wenn er wirklich startet. Schickt Claude mehrere Agents in einer
Antwort los, starten sie alle gemeinsam, sobald die Antwort fertig geschrieben ist.

`/hats` öffnet die Leiste wieder, falls sie geschlossen wurde. In der Desktop-App wird das
Maskottchen als SVG gezeichnet, im Terminal als Emoji.
