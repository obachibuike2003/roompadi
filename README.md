# RoomPadi

**Don't just find a roommate. Find your kind of person.**

RoomPadi matches people who need to share accommodation by how they actually live: budget, sleep, cleanliness, visitors, noise, smoking and chores. We're starting in Awka, around UNIZIK.

## Website

The website uses plain HTML, CSS and JavaScript, with no build step. Open `index.html` in a browser to run it, or deploy the repository root as a static site. On Render, use a **Static Site** with an empty build command and `.` as the publish directory.

What's included:

- A home page with a hero slider, browsing by area, a people grid, safety information and an FAQ
- A 9-question compatibility quiz, shown one question per screen
- A matches dashboard with filters and a compatibility score ring
- Match profiles that break the score down by category
- Private messages, with report and block
- Sign-up, log-in, phone verification and ID upload

## Current limitations

- There's no backend yet. Accounts, quiz answers and chats are stored in the visitor's browser (`localStorage`).
- SMS isn't connected, so the verification code is shown on screen.
- The 12 profiles are samples. Their photos are from [Pexels](https://www.pexels.com/license/), and the sources are listed in `assets/people/credits.json`. Replace them with real members before launch.
- `hello@roompadi.ng` is a placeholder contact address.
