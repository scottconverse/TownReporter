# TownRecord evidence handoff

In TownRecord, review and publish the selected meeting, then use **Export evidence**
in the operator workspace. In TownReporter, open **Sources & scan**, expand
**Import reviewed TownRecord evidence**, choose that JSON file, and import it.
Use the New queue to review the resulting unpublished lead. Import never creates
or publishes an article and never runs a model automatically.

The imported package keeps the community record URL, original document/recording
citations, reviewed text, transcript origin and revision. TownReporter stores
an attributed operator-supplied capture through its existing evidence system.
It is not independently verified reporting. Follow the original sources before
using its contents, and check whether the community operator has since corrected
or withdrawn the record. Previously transferred evidence is not silently erased.

A retry of the same instance/meeting/revision returns the same lead without
changing editorial work. A new reviewed revision creates separate evidence and
a new unpublished lead. Different bytes under the same revision are refused.
A failed import stays on the form with an explanation; correct the problem and
retry the same export. Uploads are bounded to 2 MB. Larger packages need a smaller
reviewed export; there is no automatic truncation. No source URL is fetched during
import and no TownRecord token is shared with TownReporter.

Only existing newsroom owners/editors can import, using their existing signed-in
session. Each newsroom has its own handoff identities. This is a file handoff,
not a background synchronization subscription or a new connector service.
