import Image from "next/image";

type IconProps = { className?: string };
function FamilyIcon({ name, className }: IconProps & { name: string }) {
  return <Image src={`/ui-icons/sprout/${name}.png`} width={96} height={96} sizes="32px" alt="" aria-hidden="true" draggable={false} className={`shrink-0 object-contain ${className ?? "h-8 w-8"}`} />;
}
export function HomeIcon(props: IconProps) { return <FamilyIcon name="home" {...props} />; }
export function CalendarDaysIcon(props: IconProps) { return <FamilyIcon name="calendar" {...props} />; }
export function UsersIcon(props: IconProps) { return <FamilyIcon name="members" {...props} />; }
export function UserIcon(props: IconProps) { return <FamilyIcon name="profile" {...props} />; }
export function PhotoIcon(props: IconProps) { return <FamilyIcon name="photo" {...props} />; }
export function MapPinIcon(props: IconProps) { return <FamilyIcon name="location" {...props} />; }
export function LockClosedIcon(props: IconProps) { return <FamilyIcon name="whisper" {...props} />; }
export function PlusIcon(props: IconProps) { return <FamilyIcon name="plus" {...props} />; }
export function MicrophoneIcon(props: IconProps) { return <FamilyIcon name="microphone" {...props} />; }
