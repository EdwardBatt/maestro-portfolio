-- `language` joins the deliverable attribute lists (I56.7).
--
-- Its own migration because extending an enum is (maestro-migration skill, and Postgres' own
-- rule: a value added to a type cannot be used in the same transaction that adds it). The list's
-- values and the column that points at them land in `20260923230000`.

alter type deliverable_attribute add value if not exists 'language';
