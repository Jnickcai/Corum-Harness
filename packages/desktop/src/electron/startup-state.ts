/** 启动展示与后台就绪的交接门禁。 */
export class StartupGate {
  private contentReady = false
  private animationFinished: boolean
  private failed = false
  private entered = false

  constructor(private readonly enter: () => void, animationEnabled: boolean) {
    this.animationFinished = !animationEnabled
  }

  ready(): void { this.contentReady = true; this.tryEnter() }
  finish(): void { this.animationFinished = true; this.tryEnter() }
  fail(): void { this.failed = true }

  private tryEnter(): void {
    if (this.failed || this.entered || !this.contentReady || !this.animationFinished) return
    this.entered = true
    this.enter()
  }
}
