import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

export default function Login() {
 const { signIn, signUp } = useAuth()
 const navigate = useNavigate()
 const [mode, setMode] = useState<'signin' | 'signup'>('signin')
 const [email, setEmail] = useState('')
 const [password, setPassword] = useState('')
 const [error, setError] = useState<string | null>(null)
 const [loading, setLoading] = useState(false)

 async function handleSubmit(e: React.FormEvent) {
 e.preventDefault()
 setError(null)
 setLoading(true)

 const fn = mode === 'signin' ? signIn : signUp
 const { error } = await fn(email, password)

 setLoading(false)
 if (error) {
 setError(error.message)
 return
 }
 if (mode === 'signup') {
 setError('가입 완료! 이메일 인증 후 로그인해주세요.')
 setMode('signin')
 return
 }
 navigate('/')
 }

 return (
 <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
 <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8">
 <div className="text-center mb-6">
 <h1 className="text-2xl font-bold text-slate-900">프로모션 어드민</h1>
 <p className="text-sm text-slate-500 mt-1">
 {mode === 'signin' ? '로그인' : '회원가입'}
 </p>
 </div>

 <form onSubmit={handleSubmit} className="space-y-4">
 <div>
 <label className="block text-sm font-medium text-slate-700 mb-1">이메일</label>
 <input
 type="email"
 value={email}
 onChange={(e) => setEmail(e.target.value)}
 required
 className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
 />
 </div>

 <div>
 <label className="block text-sm font-medium text-slate-700 mb-1">비밀번호</label>
 <input
 type="password"
 value={password}
 onChange={(e) => setPassword(e.target.value)}
 required
 minLength={6}
 className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
 />
 </div>

 {error && (
 <div className="text-sm p-3 rounded-lg bg-rose-50 text-rose-700 border border-rose-200">
 {error}
 </div>
 )}

 <button
 type="submit"
 disabled={loading}
 className="w-full py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 transition"
 >
 {loading ? '처리 중...' : mode === 'signin' ? '로그인' : '회원가입'}
 </button>
 </form>

 <div className="mt-4 text-center text-sm text-slate-500">
 {mode === 'signin' ? '계정이 없으신가요?' : '이미 계정이 있으신가요?'}{' '}
 <button
 onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null) }}
 className="text-slate-900 font-medium hover:underline"
 >
 {mode === 'signin' ? '회원가입' : '로그인'}
 </button>
 </div>
 </div>
 </div>
 )
}
