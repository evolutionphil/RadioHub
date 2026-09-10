import {Component,type ReactNode} from 'react';
import {Link} from 'wouter';

/** A failed admin page must not unmount authentication, navigation or playback. */
export class AdminPageErrorBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){
    if(!this.state.failed)return this.props.children;
    return <section role="alert" className="m-6 rounded-xl border border-red-200 bg-white p-6 text-gray-900">
      <h1 className="text-xl font-semibold">This admin page could not be displayed</h1>
      <p className="mt-2 text-sm text-gray-600">Navigation is still available. If you were saving data, reload and check the result before retrying.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white" onClick={()=>window.location.reload()}>Reload page</button>
        <Link href="/admin/dashboard" className="rounded-lg border px-4 py-2 text-sm">Dashboard</Link>
      </div>
    </section>;
  }
}
