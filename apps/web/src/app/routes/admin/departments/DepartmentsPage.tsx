import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../api/client";
import { Plus, Building2 } from "lucide-react";

export function DepartmentsPage() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "" });

  const { data: departments, isLoading } = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get<any[]>("/admin/departments"),
  });

  const addDept = useMutation({
    mutationFn: () => api.post("/admin/departments", form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["departments"] });
      setShowAdd(false);
      setForm({ name: "" });
    },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Departments</h3>
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
          <Plus size={16} /> Add Department
        </button>
      </div>

      {showAdd && (
        <div className="mb-6 rounded-xl bg-white p-6 shadow-sm">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Department Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" />
          </div>
          <button onClick={() => addDept.mutate()} disabled={addDept.isPending || !form.name} className="mt-4 rounded-lg bg-primary-600 px-6 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            Create Department
          </button>
        </div>
      )}

      <div className="rounded-xl bg-white shadow-sm">
        {isLoading ? (
          <p className="p-6 text-center text-gray-500">Loading...</p>
        ) : !departments?.length ? (
          <p className="p-6 text-center text-gray-500">No departments configured.</p>
        ) : (
          <div className="divide-y">
            {departments.map((dept: any) => (
              <div key={dept.id} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <Building2 size={20} className="text-primary-500" />
                  <div>
                    <p className="font-medium">{dept.name}</p>
                    <p className="text-sm text-gray-500">
                      {dept.site?.name ?? "No site"} &middot; {dept._count?.employees ?? 0} employees
                    </p>
                  </div>
                </div>
                {dept.manager && (
                  <span className="text-sm text-gray-500">Manager: {dept.manager.displayName}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
