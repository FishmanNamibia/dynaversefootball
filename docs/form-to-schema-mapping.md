# Form to Schema Mapping

## Section A: Player Information

| Form field | Table.Column |
| --- | --- |
| Player full name | `players.first_name`, `players.last_name` |
| Date of birth | `players.date_of_birth` |
| Gender | `players.gender` |
| ID/Birth certificate | `players.id_or_birth_cert_no` |
| Address | `players.address_line_1`, `players.address_line_2`, `players.town`, `players.region` |
| School/Grade | `players.school_name`, `players.school_grade` |
| Position | `players.preferred_position` |
| Preferred foot | `players.preferred_foot` |
| Experience | `players.years_of_experience` |
| Previous club | `players.previous_club` |
| Player code (office use) | `players.player_code` |

## Section B: Parent/Guardian

| Form field | Table.Column |
| --- | --- |
| Guardian names | `guardians.first_name`, `guardians.last_name` |
| Relationship to player | `player_guardians.relationship_to_player` |
| Phone/WhatsApp | `guardians.phone_whatsapp` |
| Alternate contact | `guardians.alternate_phone` |
| Email | `guardians.email` |
| Address | `guardians.address_line_1`, `guardians.address_line_2`, `guardians.town`, `guardians.region` |
| Primary contact | `player_guardians.is_primary_contact` |
| Billing contact | `player_guardians.is_billing_contact` |

## Section C: Emergency Contact

| Form field | Table.Column |
| --- | --- |
| Name | `emergency_contacts.full_name` |
| Relationship | `emergency_contacts.relationship_to_player` |
| Phone | `emergency_contacts.phone` |

## Section D: Medical/Safety

| Form field | Table.Column |
| --- | --- |
| Medical conditions | `medical_profiles.medical_conditions` |
| Allergies | `medical_profiles.allergies` |
| Asthma | `medical_profiles.has_asthma` |
| Injury history | `medical_profiles.injury_history` |
| Medication | `medical_profiles.current_medication` |
| Medical aid details | `medical_profiles.medical_aid_provider`, `medical_profiles.medical_aid_number` |
| Doctor/clinic | `medical_profiles.doctor_or_clinic_name`, `medical_profiles.doctor_phone` |
| Emergency treatment consent | `medical_profiles.emergency_treatment_consent` |

## Section E: Training & Fees

| Form field | Table.Column |
| --- | --- |
| Group (U9/U11/U13/U15) | `training_groups.code`, `enrollments.training_group_id` |
| Coach assignment | `enrollments.assigned_coach_id` |
| Registration fee (N$50) | `fee_plans` + `invoice_items` |
| Monthly fee (N$250) | `fee_plans` + `invoice_items` |
| Payment method | `payments.method` |
| Receipt/reference | `payments.payment_reference`, `payments.external_reference` |
| Uniform size/issued | `enrollments.uniform_size`, `enrollments.uniform_issued_on` |

## Section F: Consent

| Form field | Table.Column |
| --- | --- |
| Parent/guardian consent | `consents.consent_kind`, `consents.granted` |
| Media consent | `consents` with `consent_kind='media_permission'` |
| Signature and date | `consents.signed_by_name`, `consents.signed_on`, `consents.signature_blob` |

## Section G: Office Use

| Form field | Table.Column |
| --- | --- |
| Internal notes | `office_notes.note` |
| Group assignment confirmation | `enrollments.*` |
| Billing flags/status | `invoices.status`, `payments.*` |

