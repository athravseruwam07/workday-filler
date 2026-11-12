# Workday Filler

Chrome extension that fills job applications from a markdown profile:

- **Workday** "My Experience" page (work experience, education, skills, websites, LinkedIn) on any Workday site (`*.myworkdayjobs.com`, `*.myworkdaysite.com`, `*.workday.com`).
- **Greenhouse** application forms (`job-boards.greenhouse.io`, `boards.greenhouse.io`, and Greenhouse forms embedded on company career pages): name, email, country, phone, location, employment, education, LinkedIn/GitHub/portfolio, and any custom questions you answer in the md.

It never clicks Save and Continue or Submit, and never touches the resume or cover letter upload. Review the page, then continue yourself.

Keep your own filled-in profiles in a `profiles/` folder (git-ignored) or outside the repo. See `examples/example-profile.md` for the format.

## Install

1. Open `chrome://extensions`, turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Reload any open Workday tab once.

## Use

1. On the My Experience page, click the extension icon.
2. **Paste** your profile `.md` into the big box (or click "Paste from clipboard", "Upload .md file", or drop the file on the box). It saves automatically; the header says "Saved ✓".
3. Click **Fill this page**. (There is also a blue "Workday Filler" button at the bottom right of every Workday page that does the same with the saved profile.)
4. Check the log (in the popup and bottom right of the page) for lines starting with `!`, fix those by hand, then continue.

**Dropdowns (Skills, Field of Study, Degree):** the filler types each value, waits for Workday's list, clicks the match, and checks a chip actually appeared. If Workday ignores script-made typing, it redoes that item with real keyboard and mouse input through Chrome's debugger. While that runs Chrome shows a bar saying "Workday Filler started debugging this browser"; it goes away when the fill ends. Don't click or type on the page while it runs.

Workday's resume autofill often puts junk in Role Description and the wrong Company. The filler overwrites those fields, adds more Work Experience / Education / Website rows with "Add Another" when your profile has more entries than the page, and leaves extra prefilled rows alone.

## Profile format

One md works on both sites; each site uses the sections it has.

```
# Any title

## Personal                 (Greenhouse)
- First Name: ...
- Last Name: ...
- Email: ...
- Country: Canada          (phone country dropdown)
- Phone: ...
- Location: Waterloo, Ontario, Canada

## Work Experience
### Job Title
- Company: ...
- Location: ...
- Current: yes            (or "no"; if To is empty it counts as current)
- From: 09/2026           (MM/YYYY, "Sept 2026" and "2026-09" also work)
- To: 04/2026
- Description:
• bullet one
• bullet two

## Education
### School name
- Degree: Bachelor        (matched against the dropdown text, so a short word works best)
- Field: Mechatronics Engineering
- GPA: 3.9                (optional)
- From: 2025
- To: 2030

## Skills
- Remove suggested: yes   (optional: deletes Workday's suggested skills you didn't list)
- Python, C++, SQL        (typed into the skills box; each is matched to Workday's own name)

## Websites
- LinkedIn: https://...   (Website 1, and also the separate LinkedIn field)
- GitHub: https://...     (Website 2)
- Portfolio: https://...  (Website 3)
```

Websites are always filled LinkedIn, then GitHub, then Portfolio, then anything else, whatever order they are in the file.

Skills that Workday has no option for are listed in the log so you can add them by hand.

## Limits

I built this from the page structure Workday uses everywhere (`data-automation-id` fields) and from a saved copy of NVIDIA's My Experience page, and tested the logic on a mock of that page. It has not run on a live Workday tenant yet, so if a field says `!` in the log, tell me which one and I'll fix the selector. Some tenants add custom questions or change the Degree / Field of Study wording.
