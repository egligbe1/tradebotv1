import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.log('ErrorBoundary caught:', error.message, errorInfo?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full p-8">
          <div className="text-center space-y-4 max-w-md">
            <div className="text-4xl">⚠️</div>
            <h2 className="text-xl font-bold text-destructive">Something went wrong</h2>
            <p className="text-muted-foreground text-sm">{this.state.error?.message || 'An unexpected error occurred.'}</p>
            <button 
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
