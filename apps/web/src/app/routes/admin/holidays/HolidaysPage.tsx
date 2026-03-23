import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../api/client";
import { Plus, Calendar, ExternalLink } from "lucide-react";
import dayjs from "dayjs";

export function HolidaysPage() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", date: "", recurring: false, halfDay: false });

  const { data: holidays, isLoading } = useQuery({
    queryKey: ["holidays"],
    queryFn: () => api.get<any[]>("/admin/holidays"),
  });

  const addHoliday = useMutation({
    mutationFn: () => api.post("/admin/holidays", form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
      setShowAdd(false);
      setForm({ name: "", date: "", recurring: false, halfDay: false });
    },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Holidays</h3>
        <div className="flex items-center gap-3">
          <a
            href="https://www.kolzchut.org.il/he/%D7%97%D7%92%D7%99%D7%9D_%D7%99%D7%94%D7%95%D7%93%D7%99%D7%99%D7%9D"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <ExternalLink size={14} />
            Review Annual Israeli Holidays
          </a>
          <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
            <Plus size={16} /> Add Holiday
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="mb-6 rounded-xl bg-white p-6 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Date</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-gray-600">Day Type (Paid)</label>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="halfDay" checked={!form.halfDay} onChange={() => setForm({ ...form, halfDay: false })} />
                Full day
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="halfDay" checked={form.halfDay} onChange={() => setForm({ ...form, halfDay: true })} />
                Half day
              </label>
            </div>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.recurring} onChange={(e) => setForm({ ...form, recurring: e.target.checked })} />
            Recurring annually
          </label>
          <button onClick={() => addHoliday.mutate()} disabled={addHoliday.isPending || !form.name || !form.date} className="mt-4 rounded-lg bg-primary-600 px-6 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            Add Holiday
          </button>
        </div>
      )}

      <div className="rounded-xl bg-white shadow-sm">
        {isLoading ? (
          <p className="p-6 text-center text-gray-500">Loading...</p>
        ) : !holidays?.length ? (
          <p className="p-6 text-center text-gray-500">No holidays configured.</p>
        ) : (
          <div className="divide-y">
            {holidays.map((h: any) => (
              <div key={h.id} className="flex items-center gap-4 p-4">
                <Calendar size={20} className="text-primary-500" />
                <div>
                  <p className="font-medium">
                    {h.name}
                    {h.halfDay && (
                      <span className="ml-2 inline-block rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                        Half Day
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-gray-500">
                    {dayjs(h.date).format("MMMM D, YYYY")}
                    {h.recurring && " (recurring)"}
                    {!h.halfDay && " · Full day (paid)"}
                    {h.halfDay && " · Half day (paid)"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
