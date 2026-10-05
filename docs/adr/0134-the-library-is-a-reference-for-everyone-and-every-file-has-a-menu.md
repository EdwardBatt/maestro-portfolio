# ADR-0134: The Library is a reference everyone reads, every file has a menu, and nothing is lost by a change

- **Status:** accepted (Edward, 1 Oct) — records Edward's answers of 1 Oct, one at a time
- **Date:** 2026-10-01
- **Open Decision:** none
- **Amends:** ADR-0022 d.4 (who reads and who changes the Library) and d.5 (what "full asset management" means);
  ADR-0023 d.1 (the Library shows every review version of a piece, not only delivered ones). Reverses the 8 Sep
  "do not delete from storage" answer (`STATE.md`, Waiting on Edward) for files deleted under d.9 below.
- **Task(s):** I72

## Context

Figma section **K · LIBRARY** (`1636:497`), frames LB-01 … LB-10, and the designer's LB-NOTES frame (`1842:113`): the
live Library was tested on 28 Sep. *"The folder structure in the build is right… The gaps are in what you can do with a
file."* Edward, 1 Oct: revise the Library to the frames, and settle every action first.

What the live Library does (`src/features/library/LibraryPage.tsx`, read 1 Oct):

- A client picker, the folder tree, a file table showing the raw content type (`application/vnd.openxmlformats-…`),
  and **Download — the only thing a file can do**.
- Upload goes straight to the file picker, one signed PUT per file (`src/lib/assets/upload-asset.ts`), no progress, and
  **a same-name upload makes a second file**, never a version, though `asset_versions` exists for exactly that.
- Folders can be made and deleted; deleting one **cascades every file in it, at once** (`on delete cascade`), and the
  four standard folders are protected in the UI only (`is_system`; the database trigger was parked in L1.5).
- Nothing files a piece's work into the Library: `deliver_deliverable_version` / `promote_delivered_version_to_final`
  exist and nothing calls them (`STATE.md`, I11.4). Every Deliverables folder is empty.
- Every role with `assets:view` sees every client; `assets:manage` writes to any client.
- No size limit, no resume — on connections in Iraq and Egypt a dropped line loses the whole upload (Edward's note 1).
- Big masters are often not uploaded at all; a Drive / Dropbox / WeTransfer link is shared instead, and the Library has
  no place for it (Edward's note 3).

Edward's answers, 1 Oct, one at a time:

| # | Question | Chosen | Rejected |
|---|---|---|---|
| 1 | Preview on a file the browser cannot show | **B**: always offered; for such a file it shows the name, the kind in words and Download | A, only on showable files; C, generate previews of everything |
| 2 | A new version with a different name | **A**: the file keeps its name; a line says the latest version is the one in use | B, take the new name; C, ask |
| 3 | Going back to an older version | **A**: copied to the top as a new version; nothing lost | B, roll back and drop the newer |
| 4 | Rename | **B**: allowed, to fix a bad name; the extension comes from the file itself | A, no rename; C, Maestro names files |
| 5 | Move to… | **A**: within the same client only | B, anywhere |
| 6 | Copy link | **A**: a link into Maestro, opening the folder with the file picked out | B, public download link; C, both |
| 7 | Who deletes a file | **C**: the uploader, the client's account manager, or a Power Admin | A, without the Power Admin; B, anyone who uploads |
| 8 | After delete | **A**: Recently deleted for 30 days, then removed from storage for good | B, hidden but kept; C, kept forever |
| 9 | Who brings a file back | **A**: the same three | B, only the account manager |
| 10 | Deleting a file work uses | **A**: warn, naming the pieces, then allow | B, refuse |
| 11 | Size limit | **B → A**: 5 GB (kept after parts made more possible); bigger goes in as a link | 2 GB; 20 GB; none |
| 12 | Same name already there | **A**: ask each time — next version, or keep both | always version; always keep both |
| 13 | Uploads while working | **A**: carry on anywhere in Maestro, in a corner box | B, only while on the Library |
| 14 | Look-alike job folders | **B**: flag the pair, link both jobs; closing the duplicate moves its files to the one that stays | A, merge folders; C, nothing |
| 17 | A piece's files | **A**: every version, the moment it is uploaded for review, marked with how its review went | B, approved only; C, by hand |
| 18 | A piece's working files | **A**: optional "Add working files" when sending for review | B, required before approval; C, by hand |
| 19 | Who sees which clients | **Edward**: *"The library is intended for everyone as a reference… everyone should be able to view and download (internally), other actions scoped"* | per-person; by role reach |
| 20 | Who changes files and folders | **B**: `assets:manage`, for the clients within the holder's reach | A, any client; C, account manager only |
| 21 | Grid view | **A**: small pictures of images and PDFs, made at upload; a kind tile for the rest | B, load whole files; C, no grid |
| 22 | Where Recently deleted lives | **A**: one per client | B, one for the whole Library |
| 23 | Who sees Recently deleted | **B**: only those who can bring back — the uploader their own; the account manager and Power Admins all of the client's | A, everyone |
| 24 | Deleting a folder with files | **A**: only when empty | B, files to Recently deleted |
| 25 | Who deletes an empty folder | **A**: who made it, the account manager, a Power Admin | B, the reach rule |
| 26 | Renaming a folder | **A**: the reach rule | B, the three; C, nobody |
| 27 | Moving a folder | **A**: within the same client, with its contents, by the reach rule | B, no |
| N1 | Resume after the browser closes | **A**: remembered; pick the file again to carry on | B, start again |
| N1 | How long a half-finished upload waits | **A**: 24 hours | B, 7 days |
| N3 | How a link appears | **A**: a row in its folder, like a file; search finds it | B, a separate Links box |
| N3 | An updated link | **A**: the new link is the next version | B, edit in place |
| N3 | A link that expires | **A**: optional "expires on"; the adder told two days before; "Link expired" after | B, nothing |
| N2 | Copy to… | **A**: within the same client, by the reach rule; the copy starts at v1 | B, download and re-upload |

Questions 15–16 (duplicate names) are ADR-0135; the archive answers are ADR-0136.

## Decision

### Who

1. **Everyone inside the company reads the whole Library.** Every internal person with `assets:view` sees, searches and
   downloads every client's files. The client portal stays excluded (ADR-0022 d.4).
2. **Changing is `assets:manage`, within the holder's reach.** Upload, new folder, new version, make an older version
   current, rename (file or folder), move (file or folder), copy, add a link — for a client inside the role's reach
   (ADR-0009 scope: `self` = the clients of the person's own tasks, `team` / `department` = those of its people's tasks,
   `account` = the clients they are account manager for, `tenant` / `all_accounts` = every client). Enforced in RLS,
   not only the UI.
3. **Deleting is personal: the uploader, the client's account manager (`clients.account_manager_id`, I69), or a Power
   Admin** — a file, a link, and an empty folder (its maker in place of the uploader). The same three bring a deleted
   file back.

### Files

4. **Kind in words**, never the raw type: "Word document", "PNG image", "Video · 0:06", "Link · Google Drive". Each row
   also shows who added it and when.
5. **The file menu:** Preview · Download · Upload a new version · Version history · Rename · Move to… · Copy to… ·
   Copy link · Delete. Items the person may not use are not shown (d.2, d.3).
6. **Preview** is always offered. Images, PDFs, video and audio show in the browser; any other file shows its name, its
   kind and Download.
7. **Versions.** A new version keeps the file's name. Wherever versions are shown: *"The latest version is the one in
   use."* Making an older version current **copies it to the top as a new version**; the history never goes backwards.
8. **Rename** edits the name only; the extension is the uploaded file's own and cannot be typed.
9. **Delete** goes to the client's **Recently deleted** for **30 days**, every version with it, then the object is
   **removed from storage for good**. Deleting a file that pieces use warns first, naming them; their link then reads
   "file deleted". Recently deleted is reached from the client's page and lists only what the viewer could bring back.
10. **Move to… and Copy to…** stay inside the same client. A copy starts at v1 in its new folder; the original keeps its
    history.
11. **Copy link** copies a Maestro address that opens the folder with the file picked out. There is no public link.

### Upload

12. **One upload box, progress per file.** A file whose name is already in the folder asks: *make it the next version*,
    or *keep both*. A file over **5 GB** is refused with *"too big — share a link instead"*.
13. **Big files go in parts and resume.** A dropped connection retries the part in flight. A half-finished upload is
    remembered for **24 hours**; picking the same file again carries on from where it stopped. After 24 hours the parts
    are cleared.
14. **Uploads carry on anywhere in Maestro**, in a corner box, until the tab is closed.
15. **No upload at a client's top level or a brand's top level** — only inside a brand folder or a project folder. A
    project's top level uploads to References.

### Links

16. **A link is a row in its folder, like a file**: a name, its kind ("Link · Dropbox"), who added it and when; opening
    it goes to the address in a new tab. Search finds it.
17. **A new link for the same thing is the next version**; older links stay in the history.
18. **An optional "expires on" date.** Two days before it, the person who added the link is told (bell and email). After
    it, the row reads *"Link expired"*.

### Folders

19. **The four standard folders of a brand and of a project are locked**: never renamed, moved or deleted — enforced in
    the database (closing L1.5's parked protect-trigger), not only the UI.
20. **A folder someone made** is renamed and moved (within the client, with its contents) by the reach rule, and deleted
    **only when empty**, by its maker, the account manager or a Power Admin. *"Move or delete its 6 files first."*
21. **Look-alike project folders are flagged** (names equal ignoring capitals and spaces) with links to both jobs.
    Closing the duplicate job moves its files into the folder of the job that stays.

### Pieces

22. **Every deliverable has its own folder** under its project's Deliverables, made when the piece is made, named by its
    code and name.
23. **Every version a maker uploads for review appears there at once**, marked with its review state (in review,
    changes requested, approved, superseded). This **amends ADR-0023 d.1**: review versions remain `media_records` with
    their feedback, and the piece's folder **shows** them — one set of bytes, two views, nothing copied.
24. **Working files.** Sending work for review offers an optional "Add working files"; they file beside the exports,
    marked SOURCE.
25. **Brief proofs** filed into References are marked *"Proof · when the client asked · never read"*.

### Views and search

26. **List and Grid.** Grid shows a small picture of each image and the first page of each PDF, **made in the browser at
    upload** and stored beside the file; anything else is a tile with its kind.
27. **Search covers every client**, shows each result's full path, filters by kind and client, and opening a result opens
    its folder with the file picked out.
28. **Loading is a loading state**, never "No subfolders here" while the folder is still being read.

## Consequences

**Easier.** The Library becomes the one place to find any piece's files, its working files and its history; a client's
material is never lost by an upload, a rename, a move or a mistaken delete (30 days); designers read any client for
reference without a grant.

**Harder / new.**
- Schema: links (a provider of `external` with an address and an optional expiry), deleted-at with who, folder maker,
  piece folders, thumbnails beside objects, and RLS for d.2/d.3 — reach-scoped writes are new to these tables, which
  are tenant-wide today. pgTAP for each rule, adversarial for reach.
- The `asset-url` function gains multipart signing (B2's S3-compatible multipart API: create, sign part, complete,
  abort). B2's lifecycle rule clears unfinished large files after one day, matching d.13.
- A daily sweep removes Recently deleted after 30 days **from storage** — the first code that deletes from B2 — and the
  link-expiry notices (d.18).
- **Licensing:** PDF first-page pictures need `pdfjs-dist` (Apache-2.0, inside the allowlist; `npm run
  check:licenses`). Image pictures use the browser's canvas; nothing paid, no server compute.
- **Money:** thumbnails add a few KB per image or PDF; deleting after 30 days lowers storage against today, which keeps
  everything.

**Locked in.** Reading is company-wide; changing is reach-scoped; deleting is personal and recoverable for 30 days; a
version is never overwritten and history never goes backwards; files never cross clients; there is no public link; the
standard folders are locked in the database.

## Addendum — 1 Oct (Edward, A): who counts as within reach

d.2's reach also counts **the client's account manager and whoever opened a campaign or job of that client**, at any
scope. Without it, the person opening a job could not file the client's brief proof into the job's References before
any task exists. Built in `app.library_client_in_reach` (`20261002100000`), pgTAP 210.

