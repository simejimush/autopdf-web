'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type User = {
  id: string
  email?: string
}

export default function Home() {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    // 1) 初回：ログイン状態を取得
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) setErrorMsg(error.message)
      setUser(data.user ? { id: data.user.id, email: data.user.email ?? undefined } : null)
      setLoading(false)
    })

    // 2) 変化：ログイン/ログアウトを購読
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? { id: session.user.id, email: session.user.email ?? undefined } : null)
    })

    return () => {
      sub.subscription.unsubscribe()
    }
  }, [])

  const signIn = async () => {
    setErrorMsg(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}`,
      },
    })
    if (error) setErrorMsg(error.message)
  }

  const signOut = async () => {
    setErrorMsg(null)
    const { error } = await supabase.auth.signOut()
    if (error) setErrorMsg(error.message)
  }

  if (loading) {
    return <main style={{ padding: 24 }}>Loading...</main>
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>AutoPDF</h1>

      {errorMsg && (
        <p style={{ marginTop: 12 }}>
          Error: {errorMsg}
        </p>
      )}

      {!user ? (
        <>
          <p style={{ marginTop: 12 }}>未ログイン</p>
          <button onClick={signIn} style={{ marginTop: 12, padding: '10px 14px' }}>
            Googleでログイン
          </button>
        </>
      ) : (
        <>
          <p style={{ marginTop: 12 }}>ログイン中: {user.email ?? '(emailなし)'}</p>
          <p style={{ marginTop: 6, fontSize: 12 }}>UID: {user.id}</p>

          <button onClick={signOut} style={{ marginTop: 12, padding: '10px 14px' }}>
            ログアウト
          </button>
        </>
      )}
    </main>
  )
}
