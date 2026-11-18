import { useState, type ChangeEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InkButton } from "@/components/desk-chrome";
import {
  readRegistryEntryDetail,
  saveRegistryContact,
  saveRegistryOrganizationDetails,
  saveRegistryServiceDetails,
} from "@/lib/news/registry/registry-entry-editor";
import {
  CONTACT_LIMITS,
  ORGANIZATION_LIMITS,
  SERVICE_LIMITS,
  sharedScopeNotice,
  type ContactDetailFields,
  type FieldProblems,
  type OrganizationDetailFields,
  type ServiceDetailFields,
  type SharedEntry,
} from "@/lib/news/registry/registry-entry-editor-fields";

// Types come from the server functions themselves: a client file may not
// import a `*.server.*` file, even for a type.
type EntryDetail = Awaited<ReturnType<typeof readRegistryEntryDetail>>;
type SaveResult = Awaited<ReturnType<typeof saveRegistryServiceDetails>>;

/**
 * The registry entry editor (spec 24, Phase 2, job C1): every desk-meaningful
 * detail of one entry, in three groups that each save on their own -- the
 * service, its organization, and its contacts.
 *
 * An organization, or a contact on the organization or on a location, can be
 * used by more than one entry. Above each such group a notice says so, with the
 * other entries' names, because a save there changes them too.
 *
 * A save that the server refuses for its fields shows each problem under the
 * field it belongs to and says nothing was saved. A save that fails for any
 * other reason says the same. Nothing is removed here, and nothing is
 * published or taken down: that stays with Publish and Take down.
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

/**
 * One group's save: the call, the problems it came back with, and its words.
 * Held here so a later save replaces the older answer instead of stacking.
 */
function useGroupSave<Input>(
  serviceId: number,
  call: (input: Input) => Promise<SaveResult>,
  doneMessage: string,
) {
  const qc = useQueryClient();
  const [problems, setProblems] = useState<FieldProblems>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: call,
    onSuccess: async (result) => {
      if (result.ok) {
        setProblems({});
        setError(null);
        setMessage(doneMessage);
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
  });
  return {
    problems,
    message,
    error,
    pending: mutation.isPending,
    save: (input: Input) => {
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
        <textarea className={box} name={name} value={value} rows={3} onChange={change} />
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
  const [fields, setFields] = useState<ServiceForm>({
    name: detail.name,
    description: detail.description,
    url: detail.url,
    fees: detail.fees,
    applicationProcess: detail.applicationProcess,
    crisis: detail.crisis,
  });
  const group = useGroupSave(
    serviceId,
    (input: ServiceForm) => saveRegistryServiceDetails({ data: { serviceId, fields: input } }),
    "Service details saved.",
  );
  const common = { state: fields, setState: setFields, problems: group.problems };
  return (
    <Group title="Service details">
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          group.save(fields);
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
            onChange={(event) => setFields({ ...fields, crisis: event.target.checked })}
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
  const [fields, setFields] = useState<OrganizationForm>({
    name: detail.name,
    alternateName: detail.alternateName,
    description: detail.description,
    email: detail.email,
    website: detail.website,
    legalStatus: detail.legalStatus,
  });
  const group = useGroupSave(
    serviceId,
    (input: OrganizationForm) =>
      saveRegistryOrganizationDetails({ data: { serviceId, fields: input } }),
    "Organization details saved.",
  );
  const common = { state: fields, setState: setFields, problems: group.problems };
  return (
    <Group title="Organization details">
      <SharedNotice sharedWith={detail.sharedWith} />
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          group.save(fields);
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
}) {
  const [fields, setFields] = useState<ContactFormState>(initial);
  const [chosenScope, setChosenScope] = useState<"service" | "organization">(scope);
  const group = useGroupSave(
    serviceId,
    async (input: { fields: ContactFormState; scope: "service" | "organization" }) => {
      const result = await saveRegistryContact({
        data: { serviceId, contactId, scope: input.scope, fields: input.fields },
      });
      // A new contact leaves the form empty for the next one.
      if (result.ok && contactId === null) setFields(initial);
      return result;
    },
    doneMessage,
  );
  const common = { state: fields, setState: setFields, problems: group.problems };
  const shown =
    scopeChoice && chosenScope === "organization" ? scopeChoice.organizationSharedWith : sharedWith;
  return (
    <Group title={title}>
      <SharedNotice sharedWith={shown} />
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          group.save({ fields, scope: chosenScope });
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
        <div>
          <InkButton type="submit" tone="solid" pending={group.pending} pendingLabel="Saving…">
            {submitLabel}
          </InkButton>
        </div>
      </form>
    </Group>
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
          />
        </>
      )}
    </div>
  );
}
