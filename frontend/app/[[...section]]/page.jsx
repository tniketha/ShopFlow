import Workspace from '../../components/workspace';
import { notFound } from 'next/navigation';
export default async function Page({ params }) {
  const { section = [] } = await params;
  const pages = ['inventory', 'purchases', 'pos', 'sales'];
  if (section.length > 1 || (section.length === 1 && !pages.includes(section[0]))) notFound();
  return <Workspace />;
}
