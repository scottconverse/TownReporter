import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InkButton } from "@/components/desk-chrome";
import {
  readRegistryEntryDetail,
  removeRegistryRow,
  restoreRegistryRow,
  saveRegistryContact,
  saveRegistryOrganizationDetails,
  saveRegistryRow,
  saveRegistryServiceDetails,
} from "@/lib/news/registry/registry-entry-editor";
import {
  CONTACT_LIMITS,
  ORGANIZATION_LIMITS,
  REMOVE_THING,
  ROW_SPECS,
  SERVICE_LIMITS,
  emptyRow,
  sharedScopeNotice,
  type ContactDetailFields,
  type FieldProblems,
  type OrganizationDetailFields,
  type RemovableKind,
  type RowKind,
  type RowValues,
  type ServiceDetailFields,
  type SharedEntry,
} from "@/lib/news/registry/registry-entry-editor-fields";

// Types come from the server functions themselves: a client file may not
// import a `*.server.*` file, even for a type.
type EntryDetail = Awaited<ReturnType<typeof readRegistryEntryDetail>>;
type SaveResult = Awaited<ReturnType<typeof saveRegistryServiceDetails>>;

/**
 * The registry entry editor (spec 24, Phase 2, jobs C1 and C2): every
 * desk-meaningful detail of one entry, in groups that each save on their own --
 * the service, its organization, its contacts, its places, hours, eligibility,
 * required documents, languages and accessibility.
 *
 * An organization, or a contact on the organization or on a location, can be
 * used by more than one entry. Above each such group a notice says so, with the
 * other entries' names, because a save there changes them too.
 *
 * A save that the server refuses for its fields shows each problem under the
 * field it belongs to and says nothing was saved. A save that fails for any
 * other reason says the same. Nothing is published or taken down here: that
 * stays with Publish and Take down.
 *
 * Any row can be removed from the entry. A removal is a marker, never a delete:
 * the public page stops reading the row at once, Publish skips it, and the
 * Removed list at the bottom brings it back with Restore.
 */

const box = "w-full border border-rule bg-paper p-2 text-base";
const labelClass = "block text-base";
const DETAIL_KEY = (serviceId: number) => ["registry-entry-detail", serviceId];

/** The words above a group that other entries share. Large, dark, bordered. */
function SharedNotice({ sharedWith }: { sharedWith: readonly SharedEntry[] }) {
  const words = sharedScopeNotice(sharedWith);
  if (!words) return null;
  return (
    <p
      className="mb-3 border-l-4 border-rust bg-paper p-3 text-lg font-semibold text-ink"
      data-testid="shared-notice"
    >
      {words}
    </p>
  );
}

function FieldProblem({ problems, name }: { problems: FieldProblems; name: string }) {
  const text = problems[name];
  if (!text) return null;
  return (
    <span className="mt-1 block text-base text-rust" role="alert">
      {text}
    </span>
  );
}

/** What one group's save sends: the whole form, and the fields the editor changed. */
interface GroupSaveInput<T> {
  snapshot: T;
  changed: Partial<T>;
}

/** Every field of the two records has the same value. */
function sameValues<T extends object>(a: T, b: T): boolean {
  return (Object.keys(a) as (keyof T & string)[]).every((key) => a[key] === b[key]);
}

/** The fields whose value differs from `seed`: what the editor changed. */
function changedFrom<T extends object>(fields: T, seed: T): Partial<T> {
  const changed: Partial<T> = {};
  for (const key of Object.keys(fields) as (keyof T & string)[]) {
    if (fields[key] !== seed[key]) changed[key] = fields[key];
  }
  return changed;
}

/**
 * A form seeded from the entry as loaded. `seed` is the value the form last took
 * from the server or from a save; the editor's changes are the fields that differ
 * from it. When the entry is refetched with newer values and the form has no
 * unsaved changes, the form takes them. With unsaved changes it keeps its own,
 * so a save sends only what the editor changed.
 */
function useSeededForm<T extends object>(loaded: T) {
  const [state, setState] = useState({ seed: loaded, fields: loaded });
  let current = state;
  if (!sameValues(state.seed, loaded) && sameValues(state.fields, state.seed)) {
    current = { seed: loaded, fields: loaded };
    setState(current);
  }
  return {
    fields: current.fields,
    seed: current.seed,
    setFields: (fields: T) => setState((s) => ({ ...s, fields })),
    markSaved: (saved: T) => setState((s) => ({ ...s, seed: saved })),
    reset: (value: T) => setState({ seed: value, fields: value }),
  };
}

/**
 * One group's save: the call, the problems it came back with, and its words.
 * Held here so a later save replaces the older answer instead of stacking.
 * `onSaved` runs only when the save was made, so the form can take the saved
 * values as its new starting point.
 */
function useGroupSave<Input>(
  serviceId: number,
  call: (input: Input) => Promise<SaveResult>,
  doneMessage: string,
  onSaved: (input: Input) => void,
) {
  const qc = useQueryClient();
  const [problems, setProblems] = useState<FieldProblems>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set from the moment a save is sent until it has settled. The button only
  // shows pending after the next render, so a second submit in the same tick
  // would otherwise send the same save twice.
  const saving = useRef(false);
  const mutation = useMutation({
    mutationFn: call,
    onSuccess: async (result, input) => {
      if (result.ok) {
        setProblems({});
        setError(null);
        setMessage(doneMessage);
        onSaved(input);
      } else {
        setProblems(result.problems);
        setError(null);
        setMessage(null);
      }
      // A refusal wrote nothing, but the lists are cheap to refresh and a
      // concurrent change by someone else should show.
      await Promise.all([
        qc.invalidateQueries({ queryKey: DETAIL_KEY(serviceId) }),
        qc.invalidateQueries({ queryKey: ["registry-desk"] }),
      ]);
    },
    onError: (failure) => {
      setProblems({});
      setMessage(null);
      setError(failure instanceof Error ? failure.message : "That change was not saved.");
    },
    onSettled: () => {
      saving.current = false;
    },
  });
  return {
    problems,
    message,
    error,
    pending: mutation.isPending,
    save: (input: Input) => {
      if (saving.current) return;
      saving.current = true;
      setMessage(null);
      mutation.mutate(input);
    },
  };
}

function GroupStatus({
  problems,
  message,
  error,
}: {
  problems: FieldProblems;
  message: string | null;
  error: string | null;
}) {
  return (
    <>
      {Object.keys(problems).length > 0 ? (
        <p className="text-base text-rust" role="alert">
          Nothing was saved. Fix what is marked below, then save again.
        </p>
      ) : null}
      {problems.form ? (
        <p className="text-base text-rust" role="alert">
          {problems.form}
        </p>
      ) : null}
      {error ? (
        <p className="text-base text-rust" role="alert">
          {error} Nothing was saved.
        </p>
      ) : null}
      {message ? (
        <p className="text-base text-ink-2" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
    </>
  );
}

function TextField<T extends object>({
  label,
  name,
  state,
  setState,
  problems,
  max,
  multiline = false,
}: {
  label: string;
  name: keyof T & string;
  state: T;
  setState: (next: T) => void;
  problems: FieldProblems;
  max: number;
  multiline?: boolean;
}) {
  const change = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setState({ ...state, [name]: event.target.value });
  const value = String(state[name] ?? "");
  return (
    <label className={labelClass}>
      {label}
      {multiline ? (
        <textarea
          className={box}
          name={name}
          value={value}
          rows={3}
          maxLength={max}
          onChange={change}
        />
      ) : (
        <input className={box} name={name} value={value} maxLength={max} onChange={change} />
      )}
      <FieldProblem problems={problems} name={name} />
    </label>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 border border-rule p-3" aria-label={title}>
      <h4 className="mb-2 font-display text-xl">{title}</h4>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

type ServiceForm = ServiceDetailFields;

function ServiceGroup({ serviceId, detail }: { serviceId: number; detail: EntryDetail["service"] }) {
  const form = useSeededForm<ServiceForm>({
    name: detail.name,
    description: detail.description,
    url: detail.url,
    fees: detail.fees,
    applicationProcess: detail.applicationProcess,
    crisis: detail.crisis,
  });
  const fields = form.fields;
  const group = useGroupSave<GroupSaveInput<ServiceForm>>(
    serviceId,
    (input) => saveRegistryServiceDetails({ data: { serviceId, fields: input.changed } }),
    "Service details saved.",
    (input) => form.markSaved(input.snapshot),
  );
  const common = { state: fields, setState: form.setFields, problems: group.problems };
  return (
    <Group title="Service details">
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          group.save({ snapshot: fields, changed: changedFrom(fields, form.seed) });
        }}
      >
        <TextField<ServiceForm> label="Service name" name="name" max={SERVICE_LIMITS.name} {...common} />
        <TextField<ServiceForm>
          label="Description"
          name="description"
          max={SERVICE_LIMITS.description}
          multiline
          {...common}
        />
        <TextField<ServiceForm> label="Web address" name="url" max={SERVICE_LIMITS.url} {...common} />
        <TextField<ServiceForm> label="Fees" name="fees" max={SERVICE_LIMITS.fees} {...common} />
        <TextField<ServiceForm>
          label="How to apply"
          name="applicationProcess"
          max={SERVICE_LIMITS.applicationProcess}
          multiline
          {...common}
        />
        <label className="flex items-center gap-2 text-base">
          <input
            type="checkbox"
            name="crisis"
            checked={fields.crisis}
            onChange={(event) => form.setFields({ ...fields, crisis: event.target.checked })}
          />
          This is a crisis service
        </label>
        <GroupStatus problems={group.problems} message={group.message} error={group.error} />
        <div>
          <InkButton type="submit" tone="solid" pending={group.pending} pendingLabel="Saving…">
            Save service details
          </InkButton>
        </div>
      </form>
    </Group>
  );
}

type OrganizationForm = OrganizationDetailFields;

function OrganizationGroup({
  serviceId,
  detail,
}: {
  serviceId: number;
  detail: EntryDetail["organization"];
}) {
  const form = useSeededForm<OrganizationForm>({
    name: detail.name,
    alternateName: detail.alternateName,
    description: detail.description,
    email: detail.email,
    website: detail.website,
    legalStatus: detail.legalStatus,
  });
  const fields = form.fields;
  const group = useGroupSave<GroupSaveInput<OrganizationForm>>(
    serviceId,
    (input) => saveRegistryOrganizationDetails({ data: { serviceId, fields: input.changed } }),
    "Organization details saved.",
    (input) => form.markSaved(input.snapshot),
  );
  const common = { state: fields, setState: form.setFields, problems: group.problems };
  return (
    <Group title="Organization details">
      <SharedNotice sharedWith={detail.sharedWith} />
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          group.save({ snapshot: fields, changed: changedFrom(fields, form.seed) });
        }}
      >
        <TextField<OrganizationForm>
          label="Organization name"
          name="name"
          max={ORGANIZATION_LIMITS.name}
          {...common}
        />
        <TextField<OrganizationForm>
          label="Other name"
          name="alternateName"
          max={ORGANIZATION_LIMITS.alternateName}
          {...common}
        />
        <TextField<OrganizationForm>
          label="Description"
          name="description"
          max={ORGANIZATION_LIMITS.description}
          multiline
          {...common}
        />
        <TextField<OrganizationForm>
          label="Email address"
          name="email"
          max={ORGANIZATION_LIMITS.email}
          {...common}
        />
        <TextField<OrganizationForm>
          label="Website"
          name="website"
          max={ORGANIZATION_LIMITS.website}
          {...common}
        />
        <TextField<OrganizationForm>
          label="Legal status"
          name="legalStatus"
          max={ORGANIZATION_LIMITS.legalStatus}
          {...common}
        />
        <GroupStatus problems={group.problems} message={group.message} error={group.error} />
        <div>
          <InkButton type="submit" tone="solid" pending={group.pending} pendingLabel="Saving…">
            Save organization details
          </InkButton>
        </div>
      </form>
    </Group>
  );
}

type ContactFormState = ContactDetailFields;
type ContactSave = GroupSaveInput<ContactFormState> & { scope: "service" | "organization" };
type EntryContact = EntryDetail["contacts"][number];

const EMPTY_CONTACT: ContactFormState = {
  name: "",
  role: "",
  department: "",
  phone: "",
  phoneExtension: "",
  email: "",
  website: "",
};

function contactTitle(contact: EntryContact): string {
  const who = contact.name || contact.phone || contact.email || "Contact";
  if (contact.scope === "organization") return `${who} (the organization's main contact)`;
  if (contact.scope === "location") {
    return `${who} (contact for ${contact.locationName || "a location"})`;
  }
  return `${who} (this service's contact)`;
}

/** The fields of one contact, for changing one or adding one. */
function ContactForm({
  serviceId,
  initial,
  contactId,
  scope,
  sharedWith,
  title,
  submitLabel,
  doneMessage,
  scopeChoice,
  onChanged,
}: {
  serviceId: number;
  initial: ContactFormState;
  contactId: number | null;
  scope: "service" | "organization";
  sharedWith: readonly SharedEntry[];
  title: string;
  submitLabel: string;
  doneMessage: string;
  scopeChoice?: {
    organizationSharedWith: readonly SharedEntry[];
  };
  onChanged: (message: string) => void;
}) {
  const form = useSeededForm<ContactFormState>(initial);
  const fields = form.fields;
  const [chosenScope, setChosenScope] = useState<"service" | "organization">(scope);
  const group = useGroupSave<ContactSave>(
    serviceId,
    (input) =>
      saveRegistryContact({
        data: { serviceId, contactId, scope: input.scope, fields: input.changed },
      }),
    doneMessage,
    (input) => {
      // A new contact leaves the form empty for the next one.
      if (contactId === null) form.reset(initial);
      else form.markSaved(input.snapshot);
    },
  );
  const common = { state: fields, setState: form.setFields, problems: group.problems };
  const shown =
    scopeChoice && chosenScope === "organization" ? scopeChoice.organizationSharedWith : sharedWith;
  return (
    <Group title={title}>
      <SharedNotice sharedWith={shown} />
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          group.save({
            snapshot: fields,
            changed: changedFrom(fields, form.seed),
            scope: chosenScope,
          });
        }}
      >
        {scopeChoice ? (
          <label className={labelClass}>
            Who is this contact for?
            <select
              className={box}
              name="scope"
              value={chosenScope}
              onChange={(event) =>
                setChosenScope(event.target.value === "organization" ? "organization" : "service")
              }
            >
              <option value="service">This service only</option>
              <option value="organization">The whole organization (its main contact)</option>
            </select>
          </label>
        ) : null}
        <TextField<ContactFormState> label="Name" name="name" max={CONTACT_LIMITS.name} {...common} />
        <TextField<ContactFormState> label="Role" name="role" max={CONTACT_LIMITS.role} {...common} />
        <TextField<ContactFormState>
          label="Department"
          name="department"
          max={CONTACT_LIMITS.department}
          {...common}
        />
        <TextField<ContactFormState> label="Phone" name="phone" max={CONTACT_LIMITS.phone} {...common} />
        <TextField<ContactFormState>
          label="Extension"
          name="phoneExtension"
          max={CONTACT_LIMITS.phoneExtension}
          {...common}
        />
        <TextField<ContactFormState> label="Email address" name="email" max={CONTACT_LIMITS.email} {...common} />
        <TextField<ContactFormState> label="Website" name="website" max={CONTACT_LIMITS.website} {...common} />
        <GroupStatus problems={group.problems} message={group.message} error={group.error} />
        <div className="flex flex-wrap gap-2">
          <InkButton type="submit" tone="solid" pending={group.pending} pendingLabel="Saving…">
            {submitLabel}
          </InkButton>
          {contactId !== null ? (
            <RemoveControl
              serviceId={serviceId}
              kind="contact"
              rowId={contactId}
              sharedWith={sharedWith}
              onChanged={onChanged}
            />
          ) : null}
        </div>
      </form>
    </Group>
  );
}

/**
 * A remove or restore call: the words of its failure, and a guard so it is
 * sent once however fast it is pressed. On success `onDone` runs and the detail
 * and the desk lists are refreshed.
 */
function useRowAction(
  serviceId: number,
  call: () => Promise<SaveResult>,
  onDone: () => void,
  failureWords: string,
) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const mutation = useMutation({
    mutationFn: call,
    onSuccess: async (result) => {
      if (result.ok) {
        setError(null);
        onDone();
      } else {
        setError(`That change was refused. ${failureWords}`);
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: DETAIL_KEY(serviceId) }),
        qc.invalidateQueries({ queryKey: ["registry-desk"] }),
      ]);
    },
    onError: (failure) => {
      setError(`${failure instanceof Error ? failure.message : "That change was not made."} ${failureWords}`);
    },
    onSettled: () => {
      running.current = false;
    },
  });
  return {
    error,
    pending: mutation.isPending,
    run: () => {
      if (running.current) return;
      running.current = true;
      setError(null);
      mutation.mutate();
    },
  };
}

/** Kinds the public page never shows: their removal is kept on the desk only. */
const KEPT_ON_DESK_ONLY = new Set<RemovableKind>(["eligibility", "requiredDocument", "accessibility"]);

/** What the question says will happen to a row of this kind. */
function removeWarning(kind: RemovableKind): string {
  const lead = `Remove ${REMOVE_THING[kind]} from the entry?`;
  if (KEPT_ON_DESK_ONLY.has(kind)) {
    return `${lead} It is kept on the desk only and is not shown on the public page. You can bring it back from the Removed list.`;
  }
  return `${lead} It stops showing on the public page right away. You can bring it back from the Removed list.`;
}

/**
 * The Remove button of a row and, once pressed, the question that comes before
 * it. What it says matches what happens: the row is marked removed, nothing is
 * deleted, and the Removed list below brings it back. A row other entries use
 * says so first.
 */
function RemoveControl({
  serviceId,
  kind,
  rowId,
  sharedWith,
  onChanged,
}: {
  serviceId: number;
  kind: RemovableKind;
  rowId: number;
  sharedWith: readonly SharedEntry[];
  onChanged: (message: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const action = useRowAction(
    serviceId,
    () => removeRegistryRow({ data: { serviceId, kind, rowId } }),
    () => {
      setAsking(false);
      onChanged("Removed. It is in the Removed list below, and Restore brings it back.");
    },
    "Nothing was removed.",
  );
  if (!asking) {
    return (
      <InkButton tone="ghost" onClick={() => setAsking(true)}>
        Remove
      </InkButton>
    );
  }
  const shared = sharedScopeNotice(sharedWith);
  return (
    <div
      className="grid gap-2 border-2 border-rust bg-paper p-3"
      role="group"
      aria-label="Confirm removal"
      data-testid="remove-confirm"
    >
      {shared ? (
        <p className="text-lg font-semibold text-ink" data-testid="remove-shared-notice">
          {shared}
        </p>
      ) : null}
      <p className="text-lg text-ink">{removeWarning(kind)}</p>
      {action.error ? (
        <p className="text-base text-rust" role="alert">
          {action.error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <InkButton tone="danger" pending={action.pending} pendingLabel="Removing…" onClick={action.run}>
          Yes, remove
        </InkButton>
        <InkButton tone="ghost" onClick={() => setAsking(false)}>
          Keep it
        </InkButton>
      </div>
    </div>
  );
}

type RowForm = RowValues;

/** The group's heading for a row already in the entry. */
function rowTitle(kind: RowKind, fields: RowValues, locationName: string | null): string {
  const text = (key: string) => (typeof fields[key] === "string" ? (fields[key] as string) : "");
  switch (kind) {
    case "location":
      return `Place: ${[text("name"), text("address1")].filter(Boolean).join(", ") || "unnamed"}`;
    case "schedule": {
      const times = [text("opensAt"), text("closesAt")].filter(Boolean).join(" to ");
      const hours =
        fields.byAppointment === true
          ? "By appointment"
          : [text("days"), times].filter(Boolean).join(", ") || "see notes";
      return `Hours: ${hours}${locationName ? ` at ${locationName}` : ""}`;
    }
    case "eligibility":
      return `Who can use it: ${text("description").slice(0, 60)}`;
    case "requiredDocument":
      return `Required document: ${text("document")}`;
    case "language":
      return `Language: ${text("language")}`;
    case "accessibility":
      return `Accessibility: ${text("accessibility")}`;
  }
}

/**
 * The fields of one place, hours, eligibility rule, document, language or
 * accessibility note: to change one already in the entry (`rowId`) or to add
 * one. Which boxes there are, and their limits, come from ROW_SPECS, the same
 * list the server checks with.
 */
function RowEditForm({
  serviceId,
  kind,
  rowId,
  initial,
  sharedWith,
  title,
  submitLabel,
  doneMessage,
  placeChoices,
  onChanged,
}: {
  serviceId: number;
  kind: RowKind;
  rowId: number | null;
  initial: RowValues;
  sharedWith: readonly SharedEntry[];
  title: string;
  submitLabel: string;
  doneMessage: string;
  /** Hours being added may be tied to one of the entry's places. */
  placeChoices?: readonly { locationId: number; name: string }[];
  onChanged: (message: string) => void;
}) {
  const spec = ROW_SPECS[kind];
  const form = useSeededForm<RowForm>(initial);
  const fields = form.fields;
  const [place, setPlace] = useState("");
  const group = useGroupSave<GroupSaveInput<RowForm> & { place: string }>(
    serviceId,
    (input) =>
      saveRegistryRow({
        data: {
          serviceId,
          kind,
          rowId,
          locationId: input.place ? Number(input.place) : null,
          fields: input.changed,
        },
      }),
    doneMessage,
    (input) => {
      if (rowId === null) {
        form.reset(initial);
        setPlace("");
      } else form.markSaved(input.snapshot);
    },
  );
  const common = { state: fields, setState: form.setFields, problems: group.problems };
  return (
    <Group title={title}>
      <SharedNotice sharedWith={sharedWith} />
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          group.save({ snapshot: fields, changed: changedFrom(fields, form.seed), place });
        }}
      >
        {placeChoices && rowId === null ? (
          <label className={labelClass}>
            Where are these hours?
            <select
              className={box}
              name="locationId"
              value={place}
              onChange={(event) => setPlace(event.target.value)}
            >
              <option value="">At the service as a whole</option>
              {placeChoices.map((choice) => (
                <option key={choice.locationId} value={String(choice.locationId)}>
                  At {choice.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {spec.text.map((field) => (
          <TextField<RowForm>
            key={field.key}
            label={field.label}
            name={field.key}
            max={field.max}
            multiline={field.multiline}
            {...common}
          />
        ))}
        {spec.flags.map((flag) => (
          <label key={flag.key} className="flex items-center gap-2 text-base">
            <input
              type="checkbox"
              name={flag.key}
              checked={fields[flag.key] === true}
              onChange={(event) => form.setFields({ ...fields, [flag.key]: event.target.checked })}
            />
            {flag.label}
          </label>
        ))}
        <GroupStatus problems={group.problems} message={group.message} error={group.error} />
        <div className="flex flex-wrap gap-2">
          <InkButton type="submit" tone="solid" pending={group.pending} pendingLabel="Saving…">
            {submitLabel}
          </InkButton>
          {rowId !== null ? (
            <RemoveControl
              serviceId={serviceId}
              kind={kind}
              rowId={rowId}
              sharedWith={sharedWith}
              onChanged={onChanged}
            />
          ) : null}
        </div>
      </form>
    </Group>
  );
}

/** Link a place the organization already has to this entry. */
function LinkPlaceForm({
  serviceId,
  places,
}: {
  serviceId: number;
  places: EntryDetail["linkablePlaces"];
}) {
  const [chosen, setChosen] = useState(String(places[0]?.locationId ?? ""));
  const group = useGroupSave<{ locationId: string }>(
    serviceId,
    (input) =>
      saveRegistryRow({
        data: { serviceId, kind: "location", rowId: null, locationId: Number(input.locationId), fields: {} },
      }),
    "Place linked.",
    () => undefined,
  );
  return (
    <Group title="Link a place this organization already has">
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          group.save({ locationId: chosen });
        }}
      >
        <label className={labelClass}>
          Place
          <select
            className={box}
            name="locationId"
            value={chosen}
            onChange={(event) => setChosen(event.target.value)}
          >
            {places.map((place) => (
              <option key={place.locationId} value={String(place.locationId)}>
                {place.name}
              </option>
            ))}
          </select>
        </label>
        <GroupStatus problems={group.problems} message={group.message} error={group.error} />
        <div>
          <InkButton type="submit" tone="solid" pending={group.pending} pendingLabel="Linking…">
            Link this place
          </InkButton>
        </div>
      </form>
    </Group>
  );
}

const REMOVED_KIND_WORD: Record<RemovableKind, string> = {
  contact: "Contact",
  location: "Place",
  schedule: "Hours",
  eligibility: "Who can use it",
  requiredDocument: "Required document",
  language: "Language",
  accessibility: "Accessibility",
};

/** One removed row, and the button that brings it back. */
function RemovedItem({
  serviceId,
  item,
  onChanged,
}: {
  serviceId: number;
  item: EntryDetail["removed"][number];
  onChanged: (message: string) => void;
}) {
  const action = useRowAction(
    serviceId,
    () => restoreRegistryRow({ data: { serviceId, kind: item.kind, rowId: item.id } }),
    () => onChanged("Restored. It is back in the entry as it was before it was removed."),
    "Nothing was restored.",
  );
  return (
    <li className="grid gap-2 border border-rule p-3" data-testid="removed-item">
      <SharedNotice sharedWith={item.sharedWith} />
      <p className="text-lg">
        <span className="font-semibold">{REMOVED_KIND_WORD[item.kind]}:</span> {item.label}
      </p>
      {action.error ? (
        <p className="text-base text-rust" role="alert">
          {action.error}
        </p>
      ) : null}
      <div>
        <InkButton
          tone="ghost"
          ariaLabel={`Restore ${REMOVED_KIND_WORD[item.kind].toLowerCase()}: ${item.label}`}
          pending={action.pending}
          pendingLabel="Restoring…"
          onClick={action.run}
        >
          Restore
        </InkButton>
      </div>
    </li>
  );
}

/** Rows removed from this entry, each with Restore. */
function RemovedList({
  serviceId,
  removed,
  notice,
  onChanged,
}: {
  serviceId: number;
  removed: EntryDetail["removed"];
  notice: string | null;
  onChanged: (message: string) => void;
}) {
  return (
    <section className="mt-4 border border-rule p-3" aria-label="Removed from this entry">
      <h4 className="mb-2 font-display text-xl">Removed</h4>
      {notice ? (
        <p className="mb-2 text-base text-ink-2" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}
      {removed.length === 0 ? (
        <p className="text-base">Nothing has been removed from this entry.</p>
      ) : (
        <>
          <p className="mb-2 text-base">
            These are not on the public page. Nothing is deleted: Restore puts a row back.
          </p>
          <ul className="grid gap-3">
            {removed.map((item) => (
              <RemovedItem
                key={`${item.kind}-${item.id}`}
                serviceId={serviceId}
                item={item}
                onChanged={onChanged}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * Hours at a place this entry is no longer linked to. They are shown, not
 * offered: no form and no Remove. Restoring the place's link brings them back.
 */
function UnlinkedHours({ rows }: { rows: EntryDetail["schedules"] }) {
  return (
    <div className="mt-3 border-l-4 border-rust bg-paper p-3" data-testid="unlinked-hours">
      <p className="text-lg font-semibold text-ink">
        These hours belong to a place that is no longer linked; they come back if the place is restored.
      </p>
      <ul className="mt-2 grid gap-1">
        {rows.map((row) => (
          <li key={row.id} className="text-base">
            {rowTitle("schedule", row.fields, row.locationName)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One kind's heading, its rows, and the form that adds one. */
function RowSection({
  serviceId,
  kind,
  heading,
  rows,
  unlinked,
  addTitle,
  addLabel,
  addedMessage,
  placeChoices,
  onChanged,
}: {
  serviceId: number;
  kind: RowKind;
  heading: string;
  rows: EntryDetail["places"];
  /** Hours kept for a place the entry is no longer linked to (not live). */
  unlinked?: EntryDetail["schedules"];
  addTitle: string;
  addLabel: string;
  addedMessage: string;
  placeChoices?: readonly { locationId: number; name: string }[];
  onChanged: (message: string) => void;
}) {
  return (
    <>
      <h4 className="mt-4 font-display text-xl">{heading}</h4>
      {rows.length === 0 ? <p className="mt-2 text-base">None yet.</p> : null}
      {rows.map((row) => (
        <RowEditForm
          key={`${kind}-${row.id}`}
          serviceId={serviceId}
          kind={kind}
          rowId={row.id}
          initial={row.fields}
          sharedWith={row.sharedWith}
          title={rowTitle(kind, row.fields, row.locationName)}
          submitLabel="Save"
          doneMessage="Saved."
          onChanged={onChanged}
        />
      ))}
      {unlinked && unlinked.length > 0 ? <UnlinkedHours rows={unlinked} /> : null}
      <RowEditForm
        key={`add-${kind}`}
        serviceId={serviceId}
        kind={kind}
        rowId={null}
        initial={emptyRow(kind)}
        sharedWith={[]}
        title={addTitle}
        submitLabel={addLabel}
        doneMessage={addedMessage}
        placeChoices={placeChoices}
        onChanged={onChanged}
      />
    </>
  );
}

/**
 * The editor for one entry. `serviceId` is the entry's service. It loads the
 * entry's detail itself and refreshes it after every save.
 */
export function RegistryEntryEditor({
  serviceId,
  onClose,
}: {
  serviceId: number;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: DETAIL_KEY(serviceId),
    queryFn: () => readRegistryEntryDetail({ data: { serviceId } }),
  });
  const detail = query.data;
  // What the last remove or restore said. The row has left the page by then, so
  // the words are kept here, with the Removed list.
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="mt-4 border-t-2 border-ink pt-3" aria-label="Entry details editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-xl">All details for this entry</h3>
        <InkButton tone="ghost" onClick={onClose}>
          Close the details editor
        </InkButton>
      </div>
      {query.isError ? (
        <p className="mt-3 text-base text-rust" role="alert">
          {query.error instanceof Error ? query.error.message : "The details could not be loaded."}{" "}
          Nothing was changed.
        </p>
      ) : !detail ? (
        <p className="mt-3 text-base" role="status">
          Loading the details…
        </p>
      ) : (
        <>
          <ServiceGroup
            key={`service-${detail.service.id}`}
            serviceId={serviceId}
            detail={detail.service}
          />
          <OrganizationGroup
            key={`org-${detail.organization.id}`}
            serviceId={serviceId}
            detail={detail.organization}
          />
          <h4 className="mt-4 font-display text-xl">Contacts</h4>
          {detail.contacts.length === 0 ? (
            <p className="mt-2 text-base">This entry has no contacts yet.</p>
          ) : null}
          {detail.contacts.map((contact) => (
            <ContactForm
              key={`contact-${contact.id}`}
              serviceId={serviceId}
              contactId={contact.id}
              scope={contact.scope === "organization" ? "organization" : "service"}
              onChanged={setNotice}
              sharedWith={contact.sharedWith}
              title={contactTitle(contact)}
              submitLabel="Save contact"
              doneMessage="Contact saved."
              initial={{
                name: contact.name,
                role: contact.role,
                department: contact.department,
                phone: contact.phone,
                phoneExtension: contact.phoneExtension,
                email: contact.email,
                website: contact.website,
              }}
            />
          ))}
          <ContactForm
            key="add-contact"
            serviceId={serviceId}
            contactId={null}
            scope="service"
            sharedWith={[]}
            scopeChoice={{ organizationSharedWith: detail.organization.sharedWith }}
            title="Add a contact"
            submitLabel="Add contact"
            doneMessage="Contact added."
            initial={EMPTY_CONTACT}
            onChanged={setNotice}
          />
          <RowSection
            serviceId={serviceId}
            kind="location"
            heading="Places"
            rows={detail.places}
            addTitle="Add a new place"
            addLabel="Add place"
            addedMessage="Place added."
            onChanged={setNotice}
          />
          {detail.linkablePlaces.length > 0 ? (
            <LinkPlaceForm
              key={detail.linkablePlaces.map((place) => place.locationId).join("-")}
              serviceId={serviceId}
              places={detail.linkablePlaces}
            />
          ) : null}
          <RowSection
            serviceId={serviceId}
            kind="schedule"
            heading="Hours"
            rows={detail.schedules}
            unlinked={detail.unlinkedSchedules}
            addTitle="Add hours"
            addLabel="Add hours"
            addedMessage="Hours added."
            placeChoices={detail.places.map((place) => ({
              locationId: place.locationId ?? 0,
              name: String(place.fields.name || place.fields.address1 || "this place"),
            }))}
            onChanged={setNotice}
          />
          <RowSection
            serviceId={serviceId}
            kind="eligibility"
            heading="Who can use this service"
            rows={detail.eligibilities}
            addTitle="Add who can use this service"
            addLabel="Add"
            addedMessage="Added."
            onChanged={setNotice}
          />
          <RowSection
            serviceId={serviceId}
            kind="requiredDocument"
            heading="Required documents"
            rows={detail.requiredDocuments}
            addTitle="Add a required document"
            addLabel="Add document"
            addedMessage="Document added."
            onChanged={setNotice}
          />
          <RowSection
            serviceId={serviceId}
            kind="language"
            heading="Languages"
            rows={detail.languages}
            addTitle="Add a language"
            addLabel="Add language"
            addedMessage="Language added."
            onChanged={setNotice}
          />
          <RowSection
            serviceId={serviceId}
            kind="accessibility"
            heading="Accessibility"
            rows={detail.accessibilities}
            addTitle="Add an accessibility note"
            addLabel="Add note"
            addedMessage="Accessibility note added."
            onChanged={setNotice}
          />
          <RemovedList
            serviceId={serviceId}
            removed={detail.removed}
            notice={notice}
            onChanged={setNotice}
          />
        </>
      )}
    </div>
  );
}
