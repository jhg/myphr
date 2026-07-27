# ADR 0005: Clinical vocabulary: our own layer backed by LOINC and SNOMED CT codes

* **Status**: Accepted
* **Date**: 2026-07-25
* **Updated**: 2026-07-25
* **Decider**: Development Team

## Context

The patient records data their doctor asks for (blood pressure, glucose, weight, symptoms, adherence) and then shows it
at the appointment. For both of them to be talking about the same thing, a clinical vocabulary is needed. The initial
proposal was SNOMED CT, and three ways of using it were studied: the full edition, only its English names without the
codes, and having the application query a terminology server at runtime instead of importing anything.

The research (affiliate licence contract downloaded and read in full, endpoints tested, FHIR profiles verified) ruled
out two of the three and reordered the third.

Querying at runtime is not viable: the public instance's terms say "non-production use only", the block on
programmatic clients is active (verified with real requests), and every patient search would be sent to a third party.
The Ministry's service exists but is for authorized entities. None of this affects querying the SNOMED browser
**during development** to decide which concepts to include: that is normal use of a public website and it is how the
vocabulary is put together.

Using the names without the codes does not avoid the license: the contract defines "SNOMED CT Content" as concepts,
descriptions, and relationships, forbids translation (a prohibition that can only fall on the text), and includes the
European "database rights", which protect substantial extraction regardless of which column is extracted. The strongest
proof is by contradiction: SNOMED International created the Global Patient Set precisely to release identifiers and
preferred terms without an affiliate licence; if the texts were free, that product would have no reason to exist. And
technically, without the code you lose the stable identifier, the synonymy, and the hierarchy: what is left is an
English dictionary with legal baggage.

Two more facts shape the decision. SNOMED has no patient-facing terms and has officially decided not to have any; its
recommendation is that each implementation maintain its own friendly layer, and the Spanish translation of the core is
Latin American Spanish. And the settled rule in FHIR is LOINC for "what was measured" and SNOMED for "what was found":
the MVP's measurements carry LOINC codes, which is free and royalty-free even in commercial use.

## Decision

We define a catalog of concepts that grows with each feature: the ones that feature needs get added, and not before.
Each concept stores its standard code, the official term from the terminology, and a patient-facing label per supported
language. Concepts are declared as enums in the code, so the mapping between name and code is fixed and reviewable in
the repository itself.

The patient-facing label does not replace the correct term, it lives alongside it. SNOMED's terms are the correct ones,
but its preferred term is defined as the "clinically most appropriate" way of expressing a concept: it is the doctor's
term. In a PHR the reader is the patient, and "cephalalgia" and "headache" are the same concept said for two audiences.
We store both, so the patient's view uses their own wording and the one shown at the appointment can use the official
one. SNOMED refused to add patient-facing terms to the international edition and recommends that each implementation
contribute them; New Zealand formalized this as a national refset for patient portals.

Languages in order: English first, followed by the supported locales listed in `SupportedLocale`, with Simplified Chinese for China
(ADR 0007 fixes where the language preference lives and why it is in the clear). The official SNOMED term exists in
English for every concept; its Spanish translation is Latin American Spanish, so for Spain it has to be reviewed, and
for Chinese there is none in the IPS Terminology. That is another reason for the patient-facing label to be ours: it is
the only layer we can offer complete across all supported languages.

The codes are LOINC for measurements (weight `29463-7`, systolic `8480-6`, diastolic `8462-4`, heart rate `8867-4`,
temperature `8310-5`, all validated against the source) and SNOMED CT for symptoms and findings.

**Units are stored as UCUM codes** (`http://unitsofmeasure.org`), not free text, because that is what FHIR requires and
what avoids an impossible conversion later. Some match what you would write anyway (`mg/dL`, `mmol/L`, `g`, `mL`), but
others do not: the international unit of insulin is `[iU]`, millimeters of mercury are `mm[Hg]`, and beats per minute
are `/min`. Nobody writes that spontaneously, and fixing it later would mean re-encrypting every envelope in each
user's browser, one by one. What is shown on screen comes from the catalog and is a different thing.

**A LOINC code includes the unit of measure and also what was measured and where**, and that shapes the catalog twice
over. Capillary blood glucose measured with a glucose meter is `41653-7` in mg/dL and `14743-9` in mmol/L: they are
different LOINC concepts, not the same data in another unit. Since Spain and the United States use mg/dL while the
United Kingdom and China use mmol/L, one and the same concept in our catalog may need more than one code depending on
the user's country. The catalog entry is the concept the person sees; the code is chosen when recording the data, based
on the unit and the measurement method, which ADR 0008 decides (`docs/adr/0008-measurement-method.md`). Worth keeping
in mind when designing the table: the relationship between concept and code is not one to one. Codes are stored from
the very first recorded data point: adding FHIR on top of coded data is mechanical, whereas coding historical free text
requires manual recoding and loses the capture context. Storing only the label is the one irreversible option, and that
is why we reject it now. There is one deliberate, narrowly scoped exception, the food items of a meal, which are stored
as uncoded free text because today no source meets this ADR's requirements: ADR 0010 decides and justifies it
(`docs/adr/0010-uncoded-food-entries.md`).

**We limit ourselves to freely licensed terminology with worldwide scope.** This is not just to save ourselves
paperwork: since the project is published openly, anyone deploying it in any country must be able to do so without
legal exposure of their own. Every source entering the catalog has to meet that, and its license is referenced here
with a link to the primary source, verified and not taken from summaries:

- LOINC: Regenstrief Institute's own open license, not Creative Commons, but it grants what we need. Canonical URL
  https://loinc.org/license (checked on 2026-07-25, with a last-updated date of 21-07-2026). Verbatim from the page
  itself: "LOINC is available freely under an open license. It is free for use in both commercial and non-commercial
  systems", and from the license: "Permission is hereby granted in perpetuity, without payment of license fees or
  royalties, to use, copy, or distribute the Licensed Materials for any commercial or non-commercial purpose". The
  codes and the table, which is what we use, are "Group 1 Artifacts". No registration required.

  Concrete obligation: include this notice verbatim in the product, and in a text file if it is distributed on a
  storage medium (which is our case when publishing the repository):

  > This material contains content from LOINC (http://loinc.org). LOINC is copyright © Regenstrief
  > Institute, Inc. and the Logical Observation Identifiers Names and Codes (LOINC) Committee and is
  > available at no cost under the license at http://loinc.org/license. LOINC® is a registered United
  > States trademark of Regenstrief Institute, Inc.

  The only relevant prohibition is using the material to develop or promote a competing standard for identifying
  observations, which is not our case.

  **We stay strictly within the freely usable part, and that is checkable.** Some LOINC codes incorporate third-party
  content with its own copyright, flagged in the table's `EXTERNAL_COPYRIGHT_NOTICE` field, which may require
  additional attribution or impose restrictions. Hard rule: **no code with that field non-empty is admitted into the
  catalog**, verified on import and in a test, not left to someone remembering it. It mainly affects items from
  validated questionnaires (adherence scales such as Morisky-Green, physical activity questionnaires such as IPAQ or
  GPAQ); measurements and vital signs do not carry it. If some specific instrument is ever worth it, we review its
  notice and decide for that case.
- The MVP's SNOMED codes come from the **IPS Terminology**, which SNOMED International publishes as an open product
  under **Creative Commons Attribution 4.0**. The statement is on its official download page, verbatim: "This work is
  licensed under the Creative Commons Attribution 4.0 International License"
  (https://www.snomed.org/international-patient-summary-terminology, checked on 2026-07-25). The license text, which is
  what sets the obligations, is at https://creativecommons.org/licenses/by/4.0/ and its full legal version at
  https://creativecommons.org/licenses/by/4.0/legalcode. CC BY allows copying, redistributing, adapting, and commercial
  use, including by third parties deploying this software, in exchange for citing the source, linking the license, and
  stating whether changes were made. In practice: the catalog published in the repository carries that attribution
  alongside the data, not only in this document. Unlike the Global Patient Set, which is a flat list of identifier and
  preferred term, the IPS Terminology includes hierarchies for its scope. Its refset (`816080008`) has on the order of
  thirteen thousand concepts, measured by expansion, against the eight thousand its implementation guide cites:
  https://docs.snomed.org/implementation-guides/snomed-ips-terminology-implementation-guide/2-ips-terminology-overview
  It is downloaded as its own package with its own module, after registration: it does not come inside the
  international RF2, whose refset files do not carry these members. On download, the license file is confirmed.

The Spanish affiliate licence, which is free of charge, will be applied for at the National Release Centre when sharing
with professionals arrives or if the IPS Terminology falls short.

To build and audit the catalog during development we use public terminology servers for lookups (LOINC via the NLM
clinical tables, ICD-11 via the WHO API). It is a development tool, not a runtime dependency: the deployed application
never queries external services, per what is already decided above.

The catalog lives in the clear on the server and is searchable with ordinary SQL: it is public reference data,
identical for every user and unrelated to any patient.

What gets encrypted in each patient's records is decided by each feature, not by this ADR. Sometimes encrypting the
value will be enough, and sometimes the concept recorded will have to be encrypted too, because the very fact of
recording something can associate the person with a stigmatized condition. The general rule from ADR 0002 still holds
and the default criterion is to encrypt; departing from it has to be justified in the specific feature. The first one
to apply it is tracking event capture, in ADR 0006 (`docs/adr/0006-encrypted-event-model.md`), which encrypts the event
type as well.

No blind index is built over codes that are encrypted. The rule was already in ADR 0002 and here it has published
backing: Naveed, Kamara, and Wright (CCS 2015) recovered encrypted attributes from more than 80% of the records in 95%
of two hundred US hospitals by exploiting frequencies (https://cs.brown.edu/people/seny/pubs/edb.pdf). In a PHR the
attack is easier than in that study, not harder: each user has a handful of codes instead of thousands that average the
frequencies out, co-occurrence gives more away than each code on its own (seeing metformin and HbA1c monitoring
together identifies diabetes even if neither did alone), and even the number of codes leaks how many conditions someone
has.

There is no querying of external terminology services at runtime.

## Rationale

The middle option (names without codes) was the worst of the three: it carries the legal exposure of using SNOMED's
dataset without getting interoperability in return, which is what lives in the codes. Full SNOMED with an affiliate
license is free of charge in Spain but imposes obligations with a real cost (verbatim copyright notice, registration of
sublicenses, and updating within 180 days of each release, which since 2022 is published monthly), and for thirty
concepts that is disproportionate today. Our own vocabulary backed by codes gives the search and the display the MVP
needs, in the right language, with the door to FHIR open and with no paperwork.

The IPS Terminology as a source solves the short term, and the asymmetry works in our favor: if the full edition were
needed tomorrow, the codes already stored are the same ones.

One alternative remains without a thorough evaluation and is worth reviewing before closing the vocabulary: ICPC, the
primary care classification, is the only one that formally models the reason for encounter **as the patient expresses
it**, which is literally our use case. Its third version moved to a Creative Commons license in 2023, though we could
not confirm which specific variant.

* **Pros**: Spanish labels written for patients; no dependency on external services and no leaking of searches; no
  license paperwork to ship; standard codes from the first data point, so the bridge to FHIR and to sharing requires no
  migration.
* **Cons**: our own vocabulary has to be maintained and translated well by us; the IPS Terminology covers only the
  scope of the patient summary, without the full apparatus of synonyms or the official Spanish translation, which
  require the full edition; querying the hierarchy with ECL requires a terminology server or precomputing the
  transitive closure, because RF2 only carries direct relationships, so the MVP does not lean on grouping by families;
  and two code systems instead of one.

## Consequences

The catalog's data model has four pieces per concept: code, system (`http://snomed.info/sct` or LOINC), official term,
and our labels per language. It fits FHIR's `CodeableConcept` with no transformation: the code and the system go in
`coding`, the official term in `coding.display`, and our label in `text`, which is exactly what that field exists for.
The specification warns that `display` must carry the term published by the terminology and not wording of our own, so
respecting that split is not cosmetic.

On free software: this repository can be published with the catalog inside, because both of its sources allow it with
attribution, and whoever deploys it inherits that same permission with no paperwork. The attribution for both (LOINC's
verbatim notice and credit with a link to CC BY 4.0 for the IPS Terminology) goes in a file next to the catalog data,
not only in this ADR, because the obligation travels with the data wherever it is copied. What the repository can never
include is content from the full edition of SNOMED CT: it is obtained with an affiliate licence, which is per
organization and territory (free of charge in member countries, with fees elsewhere), so if we ever adopt it, the
pattern is the usual one in free healthcare software: the code is distributed without the terminology and each
implementer downloads their own under their own license. That responsibility belongs to the implementer and will be
documented in the README when the time comes.

The averages, extremes, and trends the patient shows at the appointment are computed in the browser, with the key in
memory. That is consistent with ADR 0002, which rejects server-side aggregates, but it is real JavaScript work that has
to be sized and does not come free just because we use standard codes.

As long as we stay on freely licensed sources there is no paperwork and no pending legal consultation, which is the
goal. The three open questions only become live if the affiliate licence is ever applied for: whether a paid PHR for
the general public collides with clause 2.2.4 of the contract, which imposes free-of-charge access on public systems
that access SNOMED-coded data; whether our own labels could be considered a translation of the descriptions, which
clause 2.4 forbids without written consent; and the national conditions of the relevant National Release Centre.
Contacts: `semanticaSNS@sanidad.gob.es` and `info@snomed.org`.

When sharing with professionals or export arrives, the order is: apply for the affiliate licence (free of charge),
adopt the Spanish National Health System Edition for synonyms and hierarchy, and meet the contract's obligations.
Already recorded data is not touched: the codes are the same.

Every new feature brings two decisions this ADR cannot anticipate: which concepts it adds to the catalog, which is
clinical judgment and not a development matter, and which part of its records is encrypted.

## Decision History

### 2026-07-25: the rule of coding everything admits one exception, the food items of a meal
Previously decided: everything recorded carries its standard code from the first data point, with no exceptions,
because storing only the label is irreversible.
Changed because: for food items there is today no source that meets both free licensing and worldwide scope, and
forcing a choice from a catalog produces the closest entry, not the correct one. The exception is limited to the food
item's text and is decided by ADR 0010 (`docs/adr/0010-uncoded-food-entries.md`); the unit is still UCUM.
