import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useRouter } from '@tanstack/react-router';
import { Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getAdminStatus, unlockAdminAccess } from '@/lib/portal-access.functions';
import { SignOutButton } from './sign-out';
import { actionError, ErrorNotice } from './action-feedback';

export function AdminAccess({children, signInPage=false, showAccount=true}: {children?: React.ReactNode; signInPage?: boolean; showAccount?: boolean}) {
 const router=useRouter();
 const client=useQueryClient(); const status=useQuery({queryKey:['admin-access'],queryFn:()=>getAdminStatus(),retry:false,staleTime:60000});
 const unlock=useServerFn(unlockAdminAccess);
 const [password,setPassword]=useState(''); const [email,setEmail]=useState(''); const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const [showPassword,setShowPassword]=useState(false);
 async function submit(event:React.FormEvent){event.preventDefault();setBusy(true);setError('');try{await unlock({data:{password,email}});const verified=await getAdminStatus();if(!verified.unlocked)throw new Error('Your browser did not retain the sign-in session. Open the preview in a new tab and try again.');setPassword('');client.setQueryData(['admin-access'],verified);if(signInPage)await router.navigate({to:'/admin',replace:true});else await client.invalidateQueries();}catch(e){setError(actionError(e,'Admin sign-in is temporarily unavailable. Please try again.'));}finally{setBusy(false);}}
 if(status.isPending)return <div className="bf-access"><ShieldCheck className="mx-auto text-primary"/><p>Checking private access…</p></div>;
 if(status.isError)return <section className="bf-access"><ErrorNotice message="We couldn’t check your session. Please try again." onRetry={()=>{void status.refetch();}} retrying={status.isFetching}/></section>;
 if(status.data?.unlocked)return <>{showAccount&&<div className="flex items-center justify-between border-b pb-3 mb-6"><span className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck size={16} className="text-primary"/>Admin · {status.data.name}</span><SignOutButton/></div>}{children}</>;
 return <section className="bf-access"><div className="bf-access-mark"><LockKeyhole size={28}/></div><h2 className="text-xl font-semibold mb-5">Admin sign in</h2><form className="bf-form text-left" onSubmit={submit}><label className="bf-field">Email<Input required type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="username"/></label><label className="bf-field">Password<span className="relative block"><Input required type={showPassword?'text':'password'} maxLength={256} value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" className="pr-10"/><button type="button" aria-label={showPassword?'Hide password':'Show password'} onClick={()=>setShowPassword(v=>!v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{showPassword?<EyeOff size={16}/>:<Eye size={16}/>}</button></span></label>{error&&<ErrorNotice message={error}/>}<Button disabled={busy} type="submit"><ShieldCheck/>{busy?'Signing in…':'Sign in'}</Button></form></section>;
}