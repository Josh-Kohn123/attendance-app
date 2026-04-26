import { useSearchParams } from "react-router-dom";

export function NotRegisteredPage() {
  const [params] = useSearchParams();
  const email = params.get("email");
  const reason = params.get("reason");

  const isDeactivated = reason === "deactivated";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 dark:from-gray-900 dark:to-gray-950">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl text-center dark:bg-gray-900 dark:shadow-black/40">
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/60">
            <svg className="h-8 w-8 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2 dark:text-gray-100">
          {isDeactivated ? "Account Deactivated" : "Access Not Set Up"}
        </h1>

        <p className="text-gray-500 mb-4 dark:text-gray-400">
          {isDeactivated
            ? "Your account has been deactivated. Please contact your administrator."
            : "Your account hasn't been set up yet. Ask your administrator to add you to the system first."}
        </p>

        {email && (
          <p className="text-sm text-gray-400 mb-6 font-mono bg-gray-50 rounded-lg px-3 py-2 dark:bg-gray-800 dark:text-gray-400">
            {email}
          </p>
        )}

        <a
          href="/login"
          className="inline-block rounded-lg bg-primary-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
        >
          Back to Sign In
        </a>

        <p className="mt-6 text-xs text-gray-400 dark:text-gray-500">
          If you believe this is an error, contact your system administrator.
        </p>
      </div>
    </div>
  );
}
