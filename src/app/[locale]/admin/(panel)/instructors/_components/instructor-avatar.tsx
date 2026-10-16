import { PersonAvatar } from "@/components/admin/person-avatar"

/** The instructor's photo, or a person in a circle while there is none. */
export function InstructorAvatar({ name, url, className }: { name: string; url: string | null; className?: string }) {
  return <PersonAvatar name={name} url={url} className={className} />
}
