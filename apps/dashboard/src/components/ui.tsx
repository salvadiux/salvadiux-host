import type{ButtonHTMLAttributes,HTMLAttributes,ReactNode}from'react';
export function Button({className='',...p}:ButtonHTMLAttributes<HTMLButtonElement>){return <button className={`button ${className}`} {...p}/>}
export function Card({className='',...p}:HTMLAttributes<HTMLDivElement>){return <section className={`card ${className}`} {...p}/>}
export function Badge({tone='neutral',children}:{tone?:string;children:ReactNode}){return <span className={`badge ${tone}`}>{children}</span>}
export function Empty({title,detail}:{title:string;detail?:string}){return <div className="empty"><strong>{title}</strong>{detail&&<span>{detail}</span>}</div>}
export function Spinner(){return <span className="spinner" aria-label="Loading"/>}
