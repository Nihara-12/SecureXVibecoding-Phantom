import AuthForm from "@/components/auth-form";
import SetupScreen from "@/components/setup-screen";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return <SetupScreen />;
  const params = await searchParams;
  return <AuthForm mode="login" info={params.message} />;
}
