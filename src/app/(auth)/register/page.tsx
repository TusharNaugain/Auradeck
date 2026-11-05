import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function RegisterPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Team access</CardTitle>
        <CardDescription>
          CRM accounts are managed by your administrator. Sign in with the Google account linked to your team membership.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button asChild className="w-full">
          <a href="/api/auth/google/start">Continue with Google</a>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </CardContent>
    </Card>
  )
}