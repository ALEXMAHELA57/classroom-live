import { Component } from 'react';

// Without this, any uncaught error anywhere in the tree unmounts the
// entire app and leaves a blank page with zero indication anything went
// wrong — which is exactly what happened here. This catches it, shows a
// recoverable message, and gives a way back to the dashboard.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled error in app tree:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page centered">
          <div className="card">
            <h1>Something went wrong</h1>
            <p className="muted">
              This part of the app hit an error. Reloading usually fixes it — if it keeps
              happening, let your teacher/admin know what you were doing when it happened.
            </p>
            <button onClick={() => window.location.assign('/')} style={{ width: '100%' }}>
              Back to dashboard
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
