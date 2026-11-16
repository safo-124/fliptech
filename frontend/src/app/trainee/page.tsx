import {redirect} from "next/navigation";

/** Moved into the one account area; next.config redirects this too. */
export default function TraineeAccountPage() {
  redirect("/account/learning");
}
