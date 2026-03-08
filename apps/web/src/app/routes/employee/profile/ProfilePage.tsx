import { useAuth } from "../../../../auth/AuthProvider";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../api/client";

export function ProfilePage() {
  const { user } = useAuth();

  const { data: employee } = useQuery({
    queryKey: ["employee", "profile"],
    queryFn: () => (user?.employee ? api.get<any>(`/employees/${user.employee.id}`) : null),
    enabled: !!user?.employee,
  });

  if (!user) return null;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-4">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-16 w-16 rounded-full" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-100 text-2xl font-bold text-primary-700">
              {user.displayName[0]}
            </div>
          )}
          <div>
            <h3 className="text-xl font-semibold">{user.displayName}</h3>
            <p className="text-gray-500">{user.email}</p>
            <div className="mt-1 flex gap-2">
              {user.roles.map((role) => (
                <span key={role} className="rounded-full bg-primary-50 px-3 py-0.5 text-xs font-medium text-primary-700">
                  {role}
                </span>
              ))}
            </div>
          </div>
        </div>

        {employee && (
          <div className="space-y-4">
            <h4 className="font-semibold text-gray-700">Employee Details</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["Employee #", employee.employeeNumber ?? "N/A"],
                ["Position", employee.position ?? "N/A"],
                ["Department", employee.department?.name ?? "N/A"],
                ["Site", employee.site?.name ?? "N/A"],
                ["Phone", employee.phone ?? "N/A"],
                ["Start Date", employee.startDate?.split("T")[0] ?? "N/A"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="font-medium">{value}</p>
                </div>
              ))}
            </div>

            {employee.positionHistory?.length > 0 && (
              <>
                <h4 className="mt-6 font-semibold text-gray-700">Position History</h4>
                <div className="space-y-2">
                  {employee.positionHistory.map((ph: any) => (
                    <div key={ph.id} className="flex items-center justify-between rounded-lg bg-gray-50 p-3 text-sm">
                      <span className="font-medium">{ph.position}</span>
                      <span className="text-gray-500">
                        {ph.startDate?.split("T")[0]} &mdash; {ph.endDate?.split("T")[0] ?? "Present"}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
