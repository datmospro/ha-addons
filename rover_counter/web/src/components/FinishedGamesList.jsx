import { MatchList } from "./ActiveGamesList";
export default function FinishedGamesList({ onViewMatch }) {
  return <MatchList finished onOpen={onViewMatch} />;
}
