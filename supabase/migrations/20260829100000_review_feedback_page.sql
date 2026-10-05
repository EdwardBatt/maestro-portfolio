-- I23.3 (ADR-0057 d.6) — a comment on a PDF can name the page it is about.
--
-- `review_feedback` has carried `pos_x`/`pos_y` (image pins) and `timecode_ms` (video) since
-- `20260728110800`, and nothing positional for a document. ADR-0023 already described this table
-- as "page-anchored / positioned feedback" — the design anticipated the column; it was never added.
-- So a brochure or an annual report is reviewed by somebody typing "page 4, second paragraph" into
-- the comment box, which is a location the system cannot read, sort, count or jump to.
--
-- WHY THIS ONE AND NOT COLLABORA. ADR-0057 d.6: a PDF needs no editing server. Page anchoring is a
-- column and a viewer, and it is deliberately NOT waiting behind `V1.9`, which is gated on two open
-- decisions (OD 26/29) and is infrastructure rather than a screen. `.docx` and `.pptx` review still
-- happens offline (d.1) and this migration does not pretend otherwise.
--
-- SHAPE. Nullable, exactly like the three anchors beside it. A comment with no anchor is the normal
-- case for every format, is first-class in rounds and resolution (d.3), and stays that way. `page`
-- is 1-based because that is what the reader sees on screen and in every PDF viewer's page box; a
-- 0-based column would be a number the surface has to translate before showing, and a translation
-- nobody can see is a bug waiting for its first off-by-one.
--
-- RLS is untouched and needs no new policy: this is a column on a table whose four policies already
-- fence every row by tenant, and none of them enumerates columns. pgTAP 068 asserts the constraint
-- and that a page-anchored comment is subject to exactly the same tenant fence as any other.

begin;

alter table review_feedback
  add column if not exists page integer
    check (page is null or page >= 1);

comment on column review_feedback.page is
  'ADR-0057 d.6: the 1-based page a document comment is about. Null for every unanchored comment '
  'and for image/video anchors, which use pos_x/pos_y and timecode_ms. Nullable forever — a '
  'comment with no anchor takes part in rounds and resolution exactly as an anchored one does.';

commit;
