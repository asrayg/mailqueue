import { createCampaignAction } from "@/app/actions";
import { NEW_ACCOUNT_DEFAULTS, STANDARD_DEFAULTS } from "@/lib/limits";

export const dynamic = "force-dynamic";

const DAYS = [
  { v: 1, label: "Mon" },
  { v: 2, label: "Tue" },
  { v: 3, label: "Wed" },
  { v: 4, label: "Thu" },
  { v: 5, label: "Fri" },
  { v: 6, label: "Sat" },
  { v: 0, label: "Sun" },
];

export default function NewCampaignPage() {
  const d = STANDARD_DEFAULTS;
  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold text-white">New Campaign</h1>
      <p className="mb-6 text-sm text-slate-400">
        Configure your outreach. Nothing sends until you review and confirm on the
        next screen. New accounts should use safer caps (
        {NEW_ACCOUNT_DEFAULTS.maxPerDay}/day).
      </p>

      <form action={createCampaignAction} className="space-y-6">
        <div className="card space-y-4">
          <div>
            <label className="label" htmlFor="name">
              Campaign name
            </label>
            <input id="name" name="name" required className="input" placeholder="Q2 Bookshop outreach" />
          </div>

          <div>
            <label className="label" htmlFor="provider">
              Mail provider
            </label>
            <select id="provider" name="provider" className="input" defaultValue="gmail">
              <option value="gmail">Gmail</option>
              <option value="outlook">Outlook</option>
              <option value="zoho">Zoho Mail</option>
            </select>
          </div>

          <div>
            <label className="label" htmlFor="subjectTemplate">
              Subject
            </label>
            <input
              id="subjectTemplate"
              name="subjectTemplate"
              required
              className="input"
              placeholder="Quick question about {{company}}"
            />
          </div>

          <div>
            <label className="label" htmlFor="cc">
              CC <span className="text-slate-500">(optional)</span>
            </label>
            <input
              id="cc"
              name="cc"
              className="input"
              placeholder="colleague@yourco.com, manager@yourco.com"
            />
            <p className="mt-1 text-xs text-slate-500">
              Fixed CC recipient(s), comma-separated — added to every email in the
              campaign.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="bcc">
              BCC <span className="text-slate-500">(optional)</span>
            </label>
            <input id="bcc" name="bcc" className="input" placeholder="archive@yourco.com" />
            <p className="mt-1 text-xs text-slate-500">
              Fixed BCC recipient(s), comma-separated. A <code>cc</code>/<code>bcc</code>{" "}
              column in your CSV adds per-recipient addresses on top of these.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="bodyTemplate">
              Email body
            </label>
            <textarea
              id="bodyTemplate"
              name="bodyTemplate"
              required
              rows={10}
              className="input font-mono"
              placeholder={"Hi {{first_name}},\n\nI'm reaching out because..."}
            />
            <p className="mt-1 text-xs text-slate-500">
              Variables: {"{{first_name}}"}, {"{{company}}"}, {"{{email}}"} and any
              CSV column.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="attachments">
              Attachments
            </label>
            <input id="attachments" name="attachments" type="file" multiple className="input" />
          </div>

          <div>
            <label className="label" htmlFor="csv">
              Recipients CSV
            </label>
            <input id="csv" name="csv" type="file" accept=".csv,text/csv" className="input" />
            <p className="mt-1 text-xs text-slate-500">
              Must include an <code>email</code> column. Optional:{" "}
              <code>first_name</code>, <code>last_name</code>, <code>company</code>,
              plus any extra fields.
            </p>
          </div>
        </div>

        <div className="card space-y-4">
          <h2 className="text-lg font-semibold text-white">Sending window</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="sendingWindowStart">
                Start
              </label>
              <input id="sendingWindowStart" name="sendingWindowStart" type="time" defaultValue="09:00" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="sendingWindowEnd">
                End
              </label>
              <input id="sendingWindowEnd" name="sendingWindowEnd" type="time" defaultValue="16:30" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="timezone">
                Timezone
              </label>
              <input id="timezone" name="timezone" defaultValue="America/Chicago" className="input" />
            </div>
          </div>
          <div>
            <span className="label">Send on days</span>
            <div className="flex flex-wrap gap-3">
              {DAYS.map((day) => (
                <label key={day.v} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="sendDays"
                    value={day.v}
                    defaultChecked={day.v >= 1 && day.v <= 5}
                  />
                  {day.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="card space-y-4">
          <h2 className="text-lg font-semibold text-white">Rate limits &amp; safety</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <label className="label" htmlFor="maxPerHour">
                Max / hour
              </label>
              <input id="maxPerHour" name="maxPerHour" type="number" min={1} defaultValue={d.maxPerHour} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="maxPerDay">
                Max / day
              </label>
              <input id="maxPerDay" name="maxPerDay" type="number" min={1} defaultValue={d.maxPerDay} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="minDelaySeconds">
                Min delay (s)
              </label>
              <input id="minDelaySeconds" name="minDelaySeconds" type="number" min={30} defaultValue={d.minDelaySeconds} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="maxDelaySeconds">
                Max delay (s)
              </label>
              <input id="maxDelaySeconds" name="maxDelaySeconds" type="number" min={30} defaultValue={d.maxDelaySeconds} className="input" />
            </div>
          </div>
          <div className="max-w-xs">
            <label className="label" htmlFor="recontactAfterDays">
              Skip if contacted within
            </label>
            <select id="recontactAfterDays" name="recontactAfterDays" defaultValue="30" className="input">
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
              <option value="never">Never re-contact</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <button type="submit" className="btn-primary">
            Create &amp; Preview
          </button>
        </div>
      </form>
    </div>
  );
}
