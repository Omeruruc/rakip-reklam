import { LoginForm } from "./login-form";

export const metadata = { title: "Giriş · Rakip Reklam Takip" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="grid min-h-screen place-items-center px-5">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-brand-500 text-xs font-bold text-white">
            RR
          </span>
          <div>
            <div className="text-sm font-semibold">Rakip Reklam Takip</div>
            <div className="text-xs muted">Yalnızca izinli e-postalar</div>
          </div>
        </div>
        <LoginForm next={params.next} />
      </div>
    </div>
  );
}
