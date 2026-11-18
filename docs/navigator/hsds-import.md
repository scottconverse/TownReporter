# Import a directory file (HSDS JSON)

This guide is for the desk editor. Use it to read a directory's file into the community resource registry, and to remove and restore rows of an entry afterward. The page is `/desk/registry`, in the **Imports** section.

## What the file must be

- A JSON file that ends in `.json`.
- 8 MB or smaller.
- In the HSDS bundle shape: a top-level object with an `organizations` list. An optional `taxonomies` list holds the categories. Each organization can hold its `services`, `locations` and `phones`. Each service can hold `phones`, `schedules`, `eligibilities`, `required_documents`, `languages`, `accessibilities` and `service_at_locations`.
- Other formats (CSV, XML, a spreadsheet) are not read.

A sample file is in the code at `src/lib/news/registry/__fixtures__/sample-bundle.json`.

## Steps

1. Open `/desk/registry`. Find **Import a directory file** in **Imports**.
2. Under **JSON file**, choose the file.
3. Under **Directory name**, type the name of the directory. The name is how a repeat import finds the same rows. Use the same name every time you import this directory. The box suggests names of earlier imports.
4. Press **Preview**. Preview saves nothing. No row in the registry changes.
5. Read the preview. See "What the counts mean" below.
6. If the panel says **This looks like a new directory.**, no earlier import used this name. If you meant an earlier directory, check the spelling.
7. Press **Import**. **Import** is off until a good preview of exactly this file and this name is on screen. If you change the file or the name, the preview is cleared and you preview again.
8. The panel says **Imported** with the directory name, then **Nothing was published.** The same counts are shown.

## If the file is refused

The panel says **The file could not be used:** and lists each problem. Each problem names the bad record, for example `organizations[2].services[0]: name is missing`. At most 50 problems are listed. Nothing is imported. Fix the file and press **Preview** again.

If the connection fails when you press **Import**, the panel says the import may or may not have finished. Look at the list of imports below the panel before you try again.

## What the counts mean

The table has one row for each kind of record that the file holds.

| Column | Meaning |
|---|---|
| **New** | The file has a row that is not stored. It is added, unpublished. |
| **Unchanged** | The row is stored and the file says the same. |
| **Changed, for review** | The row is stored and the file says something different. The stored row is not changed. The difference becomes a pending proposal. |
| **Already waiting** | The row differs, but the same proposal is already pending. It is not added again. |

Under the table, the panel lists each difference: the kind of record, its id in the file, the field, what is stored, and what the file says. A long list shows the first 100 and counts the rest.

Each import is saved in the list of imports with its date, format and these counts.

## What never happens

- **Nothing is published.** Every imported row starts unpublished and unverified. A reader sees a row only after an editor presses **Publish** on its entry.
- **A stored row is never overwritten.** A difference waits as a proposal in **Detected changes**. Review of these proposals is not built yet, so a proposal does not change the directory.
- **The same proposal is not repeated.** A second import of the same file adds no new proposals for differences that are already waiting.
- **A status is not a change** when the file says **unverified** or gives no status.
- **A removed row does not come back.** If an editor removed a row from an entry, an import leaves it removed. It counts as unchanged.
- **A bad file writes nothing.** A failed import is rolled back as a whole.

## Remove and restore a row of an entry

1. On the entry, press **All details**.
2. Find the row. Contacts, places, hours, eligibility rules, required documents, languages and accessibility notes can be removed.
3. Press **Remove**. If other entries share the row, a notice names them first. Then press **Yes, remove**. Press **Keep it** to stop.
4. The row leaves its group and appears in **Removed** at the bottom. The public page stops reading it at once. **Publish** skips it.
5. To bring it back, press **Restore** on the row in **Removed**.

A removal is a marker. Nothing is deleted. Removing a place removes this entry's link to the place. The place itself stays, because other entries can use it.

## Not yet

Review of the proposals (accept, reject, send back) and the verification steps are not built. A public search and a public JSON feed are not built either.
